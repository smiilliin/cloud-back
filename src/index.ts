import express, { Response } from "express";
import Strings from "fetchstrings/dist/strings";
import en from "./strings/en.json";
import { changeCapacity, getCapacity, postPublicPath, setCapacity } from "./db";
import { env } from "./env";
import cookieParser from "cookie-parser";
import { IError, generation, pool } from "./static";
import fs from "fs";
import path from "path";
import http from "http";
import WebSocket from "ws";
import { IAccessToken } from "token-generation";
import fastFolderSizeSync from "fast-folder-size/sync";
import RegisterRouter from "./routers/register";
import IndirRouter from "./routers/indir";
import PublicRouter from "./routers/public";
import reqlimit from "./reqlimit";

const app = express();

app.disable("x-powered-by");
app.set("etag", false);
app.use(express.json());
app.use(cookieParser());

app.use("/register", RegisterRouter);
app.use("/", IndirRouter);
app.use("/public", PublicRouter);

const programPattern = /^[A-Za-z0-9]*$/;
const getPathPattern = (id: string, program: string) => {
  return new RegExp(
    `^${env.cloud_path.replace(
      /\//g,
      "\\/"
    )}\\/${id}\\/${program}\\/(?!^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$)[^\\x00-\\x1F\\:*?"'<>|\r\n]*$`
  );
};

const isValidPath = (
  id: string,
  program: string,
  absolutePath: string
): boolean => {
  const pattern = getPathPattern(id, program);
  const absolutePathLength = Buffer.byteLength(
    getNormalizedPath(absolutePath),
    "utf-8"
  );

  return (
    pattern.test(absolutePath) &&
    absolutePathLength >= 0 &&
    absolutePathLength <=
      env.max_path_length - Buffer.byteLength(env.cloud_path)
  );
};
const isValidProgram = (program: string): boolean => {
  const programLength = Buffer.byteLength(program, "utf-8");
  return (
    programPattern.test(program) && programLength <= env.max_program_length
  );
};
const isValidDir = (id: string, program: string, dir: string): boolean => {
  const pattern = getPathPattern(id, program);
  const dirLength = Buffer.byteLength(getNormalizedPath(dir), "utf-8");

  return (
    pattern.test(dir) &&
    fs.existsSync(dir) &&
    dirLength <=
      env.max_path_length -
        env.max_indir_length -
        Buffer.byteLength(env.cloud_path)
  );
};
const isValidIndirName = (indirName: string): boolean => {
  const pattern =
    /^(?!^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$)[^\x00-\x1F\\/:*?"'<>|\r\n]*$/;
  const nameLength = Buffer.byteLength(indirName, "utf-8");

  return pattern.test(indirName) && nameLength <= env.max_indir_length;
};
const getNormalizedPath = (x: string): string => {
  if (x.at(-1) != "/") return x + "/";
  return x;
};
const isPathMatch = (a: string, b: string): boolean => {
  return getNormalizedPath(a) == getNormalizedPath(b);
};
const getPathCapacity = (absolutePath: string) => {
  const capacity = fastFolderSizeSync(absolutePath);
  if (capacity == undefined) throw new Error("capacity is undefined");
  return capacity;
};

export {
  isValidPath,
  isValidIndirName,
  isPathMatch,
  getNormalizedPath,
  isValidDir,
  isValidProgram,
  getPathCapacity,
};

new Strings(app);

app.use((req, res: Response<IError>) => {
  res.status(404).send({ reason: "BAD_REQUEST" });
});
app.use((err: unknown, req: express.Request, res: express.Response) => {
  console.error(err);
  res.status(500).send({ reason: "SERVER_ERROR" });
});

const httpServer = http.createServer(app).listen(env.port, () => {
  console.log("cloud-back is running");
});
interface IUploadOption {
  absolutePath: string;
  mtimeMs: number;
  birthtimeMs: number;
}

const wsSend = <T>(ws: WebSocket, data: T) => {
  ws.send(JSON.stringify(data));
};
const wsSendReason = wsSend<ITypeReason>;
const wss = new WebSocket.Server({ server: httpServer });

(() => {
  fs.readdirSync(env.cloud_path).forEach((id) => {
    setCapacity(id, getPathCapacity(path.join(env.cloud_path, id)));
  });
})();

interface ITypeSuccess {
  type: string;
}
interface INid extends ITypeSuccess {
  nid: string;
}
interface ITypeReason {
  type: string;
  reason: keyof typeof en;
}

wss.on("connection", async (ws) => {
  let token: string | undefined;
  let tokenPayload: IAccessToken | null = null;
  let uploadOption: IUploadOption | undefined;
  let uploadStream: fs.WriteStream | undefined;
  let uploadedBytes: number = 0;
  let uploadSize: number = 0;
  let onProcessMessageQueue = false;

  let sleepTimeout = setTimeout(() => {
    close();
  }, env.sleep_timeout);
  const close = (wsClosed?: boolean) => {
    clearTimeout(sleepTimeout);
    if (uploadStream) uploadStream.close();
    if (!wsClosed) ws.close();
  };
  const parseMessage = (message: WebSocket.RawData) => {
    try {
      return JSON.parse(message.toString("utf-8"));
    } catch {
      return {};
    }
  };

  const messageQueue: Array<IMessage> = [];

  interface IMessage {
    message: WebSocket.RawData;
    isBinary: boolean;
  }
  ws.on("message", (message, isBinary) => {
    messageQueue.push({ message: message, isBinary: isBinary });

    if (messageQueue.length > 10) {
      wsSendReason(ws, { type: "any", reason: "TOO_MANY_REQUESTS" });
      return;
    }
    if (!onProcessMessageQueue) {
      onProcessMessageQueue = true;
      processMessageQueue();
    }
  });
  const processMessageQueue = async () => {
    while (messageQueue.length != 0) {
      const message = messageQueue.shift();
      await processMessage(message as IMessage);
    }

    onProcessMessageQueue = false;
  };
  const closeUploadStream = (): void => {
    if (uploadStream) {
      uploadStream.close();
      uploadStream = undefined;
      uploadedBytes = 0;

      if (uploadOption) {
        try {
          fs.utimesSync(
            uploadOption.absolutePath,
            new Date(uploadOption.birthtimeMs),
            new Date(uploadOption.mtimeMs)
          );
        } catch (err) {
          console.error(err);
        }
      }
    }
  };

  const processMessage = async ({ message, isBinary }: IMessage) => {
    clearTimeout(sleepTimeout);
    sleepTimeout = setTimeout(() => {
      close();
    }, env.sleep_timeout);

    if (!isBinary) {
      const { type, data } = parseMessage(message);

      switch (type) {
        case "token": {
          if (!data || typeof data != "string") {
            wsSendReason(ws, { type: "token", reason: "UNAVAILABLE_DATA" });
            return;
          }
          const tokenPayloadTmp = generation.verifyAccessToken(data);

          if (!tokenPayloadTmp) {
            wsSendReason(ws, { type: "token", reason: "UNAVAILABLE_TOKEN" });
            return;
          } else {
            const { id } = tokenPayloadTmp;

            if (!reqlimit(pool, id, 1)) {
              wsSendReason(ws, {
                reason: "TOO_MANY_REQUESTS",
                type: "token",
              });
              return;
            }
            token = data;
            tokenPayload = tokenPayloadTmp;
            wsSend<ITypeSuccess>(ws, { type: "token" });
            return;
          }
        }
        case "option": {
          if (!data) {
            wsSendReason(ws, { type: "option", reason: "UNAVAILABLE_DATA" });
            return;
          }
          if (!token || !tokenPayload) {
            wsSendReason(ws, { type: "option", reason: "UNAVAILABLE_TOKEN" });
            return;
          }
          const {
            name,
            dir,
            program: _program,
            mtimeMs,
            birthtimeMs,
            size,
            toPubilc,
          } = data;
          const program = _program || "cloud";

          const { id } = tokenPayload;

          if (typeof program != "string" || !isValidProgram(program)) {
            wsSendReason(ws, { type: "option", reason: "UNAVAILABLE_PROGRAM" });
            return;
          }
          const absoluteDir = path.join(env.cloud_path, id, program, dir);
          if (
            typeof absoluteDir != "string" ||
            !isValidDir(id, program, absoluteDir)
          ) {
            wsSendReason(ws, {
              type: "option",
              reason: "UNAVAILABLE_DIRECTORY",
            });
            return;
          }
          if (typeof mtimeMs != "number") {
            wsSendReason(ws, { type: "option", reason: "UNAVAILABLE_MTIMEMS" });
            return;
          }
          if (typeof birthtimeMs != "number") {
            wsSendReason(ws, {
              type: "option",
              reason: "UNAVAILABLE_BIRTHTIMEMS",
            });
            return;
          }
          closeUploadStream();

          const absolutePath = path.join(
            env.cloud_path,
            id,
            program,
            dir,
            name
          );
          uploadOption = {
            absolutePath: absolutePath,
            mtimeMs: mtimeMs,
            birthtimeMs: birthtimeMs,
          };

          let existsFileSize: number = 0;
          if (fs.existsSync(absolutePath)) {
            try {
              existsFileSize = fs.statSync(absolutePath).size;
            } catch (err) {
              wsSendReason(ws, { type: "any", reason: "UNKNOWN_ERROR" });
              return;
            }
          }
          if (typeof size != "number") {
            wsSendReason(ws, {
              type: "option",
              reason: "UNAVAILABLE_SIZE",
            });
            return;
          }
          uploadSize = size;
          if (
            ((await getCapacity(id)) || 0 + uploadSize) > env.max_cloud_capacity
          ) {
            wsSendReason(ws, { type: "raw", reason: "TOO_BIG_SIZE" });
            return;
          }

          uploadStream = fs.createWriteStream(absolutePath);
          uploadStream.on("error", () => {
            wsSendReason(ws, { type: "any", reason: "UNKNOWN_ERROR" });

            if (uploadStream) {
              if (existsFileSize) {
                changeCapacity(id, uploadStream.bytesWritten);
              }
              uploadStream.close();
              uploadStream = undefined;
            }
          });
          uploadStream.on("ready", () => {
            if (existsFileSize) {
              changeCapacity(id, existsFileSize * -1);
            }
          });

          if (toPubilc) {
            const nid = await postPublicPath(
              tokenPayload.id,
              uploadOption.absolutePath
            );
            wsSend<INid>(ws, { type: "option", nid: nid });
          } else {
            wsSend<ITypeSuccess>(ws, { type: "option" });
          }
          return;
        }
        case "close": {
          closeUploadStream();

          return;
        }
      }
    } else if (message instanceof Buffer) {
      if (!token || !tokenPayload) {
        wsSendReason(ws, { type: "option", reason: "UNAVAILABLE_TOKEN" });
        return;
      }

      if (!uploadStream || uploadStream.closed) {
        wsSendReason(ws, { type: "raw", reason: "STREAM_NOT_OPENED" });
        return;
      }

      const { id } = tokenPayload;

      const size: number = message.byteLength;

      if (((await getCapacity(id)) || 0 + size) > env.max_cloud_capacity) {
        wsSendReason(ws, { type: "raw", reason: "CAPACITY_FULL" });
        return;
      }

      uploadedBytes += size;

      if (uploadedBytes > uploadSize) {
        wsSendReason(ws, { type: "raw", reason: "SEND_EXCEEDED" });
        return;
      }
      await changeCapacity(id, size);

      uploadStream.write(message);
      wsSend(ws, { type: "raw", uploadedBytes: uploadedBytes });
    }
  };

  ws.on("close", () => {
    closeUploadStream();
    close(true);
  });
  ws.on("error", (error: Error) => {
    close();
    console.error(error);
  });
});
