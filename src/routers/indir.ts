import reqlimit from "@/reqlimit";
import { IError, ISuccess, generation, pool } from "@/static";
import express, { Response } from "express";
import mime from "mime";
import {
  deletePublicPath,
  isCloudUser,
  changeCapacity,
  getPublicPath,
  renamePublicPath,
} from "@/db";
import fs from "fs";
import path from "path";
import { env } from "@/env";
import {
  getPathCapacity,
  isPathMatch,
  isValidDir,
  isValidIndirName,
  isValidPath,
  isValidProgram,
} from "..";

const IndirRouter = express.Router();

interface IIndir {
  name?: string;
  isDir: boolean;
  mtimeMs: number;
  birthtimeMs: number;
}
interface IReaddir {
  inDir: Array<IIndir>;
}
IndirRouter.get("/readdir", async (req, res: Response<IError | IReaddir>) => {
  let id: string;

  let absolutePath: string;

  const { path: relativePath, program, nid } = req.query;

  if (typeof relativePath != "string") {
    res.status(400).send({ reason: "UNAVAILABLE_PATH" });
    return;
  }
  if (nid) {
    if (typeof nid != "string") {
      res.status(400).send({ reason: "UNAVAILABLE_NID" });
      return;
    }
    const publicRelativePath = await getPublicPath(nid);

    if (!publicRelativePath) {
      res.status(400).send({ reason: "UNAVAILABLE_NID" });
      return;
    }
    absolutePath = path.join(env.cloud_path, publicRelativePath, relativePath);
  } else {
    const accessToken = generation.verifyAccessToken(
      req.headers.authorization || req.cookies["access-token"]
    );
    if (!accessToken) {
      return res.status(400).send({ reason: "UNAVAILABLE_TOKEN" });
    }
    id = accessToken.id;

    if (!reqlimit(pool, id, 1)) {
      res.status(400).send({ reason: "TOO_MANY_REQUESTS" });
      return;
    }

    if (!(await isCloudUser(id))) {
      res.status(400).send({ reason: "NOT_REGISTERED" });
      return;
    }

    if (typeof program !== "string" || !isValidProgram(program)) {
      res.status(400).send({ reason: "UNAVAILABLE_PROGRAM" });
      return;
    }
    absolutePath = path.join(env.cloud_path, id, program, relativePath);

    if (!isValidPath(id, program, absolutePath)) {
      res.status(400).send({ reason: "UNAVAILABLE_PATH" });
      return;
    }
  }

  try {
    const inDir: Array<IIndir> = fs
      .readdirSync(absolutePath, "utf8")
      .map((fileName) => {
        const isDir = fs
          .statSync(path.join(absolutePath, fileName))
          .isDirectory();
        const { mtimeMs, birthtimeMs } = fs.statSync(
          path.join(absolutePath, fileName)
        );

        return {
          name: fileName,
          isDir: isDir,
          mtimeMs: mtimeMs,
          birthtimeMs: birthtimeMs,
        };
      });

    res.status(200).send({ inDir: inDir });
  } catch {
    res.status(400).send({ reason: "UNKNOWN_ERROR" });
  }
});
IndirRouter.post("/program", async (req, res: Response<IError | ISuccess>) => {
  const accessToken = generation.verifyAccessToken(
    req.headers.authorization || req.cookies["access-token"]
  );
  if (!accessToken) {
    return res.status(400).send({ reason: "UNAVAILABLE_TOKEN" });
  }

  const { id } = accessToken;

  if (!reqlimit(pool, id, 1)) {
    res.status(400).send({ reason: "TOO_MANY_REQUESTS" });
    return;
  }

  if (!(await isCloudUser(id))) {
    res.status(400).send({ reason: "NOT_REGISTERED" });
    return;
  }

  const { program } = req.body;

  if (typeof program !== "string" || !isValidProgram(program)) {
    res.status(400).send({ reason: "UNAVAILABLE_PROGRAM" });
    return;
  }
  const absolutePath = path.join(env.cloud_path, id, program);

  try {
    fs.mkdirSync(absolutePath);

    res.status(200).send({});
  } catch {
    res.status(400).send({ reason: "UNKNOWN_ERROR" });
  }
});
IndirRouter.delete(
  "/program",
  async (req, res: Response<IError | ISuccess>) => {
    const accessToken = generation.verifyAccessToken(
      req.headers.authorization || req.cookies["access-token"]
    );
    if (!accessToken) {
      return res.status(400).send({ reason: "UNAVAILABLE_TOKEN" });
    }

    const { id } = accessToken;

    if (!reqlimit(pool, id, 1)) {
      res.status(400).send({ reason: "TOO_MANY_REQUESTS" });
      return;
    }

    if (!(await isCloudUser(id))) {
      res.status(400).send({ reason: "NOT_REGISTERED" });
      return;
    }

    const { program } = req.body;

    if (typeof program !== "string" || !isValidProgram(program)) {
      res.status(400).send({ reason: "UNAVAILABLE_PROGRAM" });
      return;
    }
    const absolutePath = path.join(env.cloud_path, id, program);

    try {
      deletePublicPath(absolutePath);

      const stat = fs.statSync(absolutePath);
      let capacity;
      if (stat.isDirectory()) {
        capacity = getPathCapacity(absolutePath);
      } else {
        capacity = stat.size;
      }

      fs.rmSync(absolutePath, { recursive: true });
      changeCapacity(id, capacity * -1);
      res.status(200).send({});
    } catch (err) {
      console.error(err);
      res.status(400).send({ reason: "UNKNOWN_ERROR" });
    }
  }
);
IndirRouter.post("/mkdir", async (req, res: Response<IError | ISuccess>) => {
  const accessToken = generation.verifyAccessToken(
    req.headers.authorization || req.cookies["access-token"]
  );
  if (!accessToken) {
    return res.status(400).send({ reason: "UNAVAILABLE_TOKEN" });
  }

  const { id } = accessToken;

  if (!reqlimit(pool, id, 1)) {
    res.status(400).send({ reason: "TOO_MANY_REQUESTS" });
    return;
  }

  if (!(await isCloudUser(id))) {
    res.status(400).send({ reason: "NOT_REGISTERED" });
    return;
  }

  const { dir: relativeDir, program: _program, name } = req.body;
  const program = _program || "cloud";

  if (typeof relativeDir != "string") {
    res.status(400).send({ reason: "UNAVAILABLE_DIRECTORY" });
    return;
  }
  if (typeof program !== "string" || !isValidProgram(program)) {
    res.status(400).send({ reason: "UNAVAILABLE_PROGRAM" });
    return;
  }
  if (typeof name != "string" || !isValidIndirName(name)) {
    res.status(400).send({ reason: "UNAVAILABLE_NAME" });
    return;
  }
  const absoluteDir = path.join(env.cloud_path, id, program, relativeDir);
  const absolutePath = path.join(
    env.cloud_path,
    id,
    program,
    relativeDir,
    name
  );

  if (!isValidDir(id, program, absoluteDir)) {
    res.status(400).send({ reason: "UNAVAILABLE_DIRECTORY" });
    return;
  }

  try {
    fs.mkdirSync(absolutePath);

    res.status(200).send({});
  } catch {
    res.status(400).send({ reason: "UNKNOWN_ERROR" });
  }
});
IndirRouter.get("/download", async (req, res: Response<IError | ISuccess>) => {
  let id: string;

  const { path: relativePath, program: _program, nid } = req.query;
  const program = _program || "cloud";

  if (typeof relativePath != "string") {
    res.status(400).send({ reason: "UNAVAILABLE_PATH" });
    return;
  }

  let absolutePath: string;
  if (nid) {
    if (typeof nid !== "string") {
      res.status(400).send({ reason: "UNAVAILABLE_NID" });
      return;
    }
    const publicRelativePath = await getPublicPath(nid);

    if (!publicRelativePath) {
      res.status(400).send({ reason: "NOT_EXISTS" });
      return;
    }
    absolutePath = publicRelativePath;
  } else {
    const accessToken = generation.verifyAccessToken(
      req.headers.authorization || req.cookies["access-token"]
    );
    if (!accessToken) {
      return res.status(400).send({ reason: "UNAVAILABLE_TOKEN" });
    }

    id = accessToken.id;

    if (!reqlimit(pool, id, 1)) {
      res.status(400).send({ reason: "TOO_MANY_REQUESTS" });
      return;
    }

    if (!(await isCloudUser(id))) {
      res.status(400).send({ reason: "NOT_REGISTERED" });
      return;
    }
    if (typeof program !== "string" || !isValidProgram(program)) {
      res.status(400).send({ reason: "UNAVAILABLE_PROGRAM" });
      return;
    }

    absolutePath = path.join(env.cloud_path, id, program, relativePath);

    if (!isValidPath(id, program, absolutePath)) {
      res.status(400).send({ reason: "UNAVAILABLE_PATH" });
      return;
    }
  }
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
    res.status(400).send({ reason: "NOT_EXISTS" });
    return;
  }

  try {
    res.status(200).download(absolutePath);
  } catch {
    res.status(400).send({ reason: "UNKNOWN_ERROR" });
  }
});
IndirRouter.get("/file", async (req, res: Response<IError | ISuccess>) => {
  let id: string;

  const { path: relativePath, program: _program, nid } = req.query;
  const program = _program || "cloud";

  if (typeof relativePath != "string") {
    res.status(400).send({ reason: "UNAVAILABLE_PATH" });
    return;
  }

  let absolutePath: string;
  if (nid) {
    if (typeof nid !== "string") {
      res.status(400).send({ reason: "UNAVAILABLE_nid" });
      return;
    }
    const publicRelativePath = await getPublicPath(nid);

    if (!publicRelativePath) {
      res.status(400).send({ reason: "NOT_EXISTS" });
      return;
    }
    absolutePath = publicRelativePath;
  } else {
    const accessToken = generation.verifyAccessToken(
      req.headers.authorization || req.cookies["access-token"]
    );
    if (!accessToken) {
      return res.status(400).send({ reason: "UNAVAILABLE_TOKEN" });
    }

    id = accessToken.id;

    if (!reqlimit(pool, id, 1)) {
      res.status(400).send({ reason: "TOO_MANY_REQUESTS" });
      return;
    }

    if (!(await isCloudUser(id))) {
      res.status(400).send({ reason: "NOT_REGISTERED" });
      return;
    }

    if (typeof program !== "string" || !isValidProgram(program)) {
      res.status(400).send({ reason: "UNAVAILABLE_PROGRAM" });
      return;
    }

    absolutePath = path.join(env.cloud_path, id, program, relativePath);

    if (!isValidPath(id, program, absolutePath)) {
      res.status(400).send({ reason: "UNAVAILABLE_PATH" });
      return;
    }
  }
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
    res.status(400).send({ reason: "NOT_EXISTS" });
    return;
  }

  try {
    const mimeType = mime.lookup(absolutePath);

    const safeMimeTypes = [
      "text/plain",
      "image/jpeg",
      "image/png",
      "image/webp",
      "video/webm",
      "audio/mpeg",
      "audio/aac",
      "audio/wav",
      "application/json",
      "image/svg+xml",
      "application/pdf",
    ];
    if (!safeMimeTypes.includes(mimeType)) {
      res.status(400).send({ reason: "FILE_UNSAFE" });
      return;
    }
    res.setHeader("Content-Type", [mimeType, "charset=utf-8"].join(";"));
    res
      .status(200)
      .sendFile(absolutePath, { etag: false, lastModified: false });
  } catch {
    res.status(400).send({ reason: "UNKNOWN_ERROR" });
  }
});
IndirRouter.get("/stat", async (req, res: Response<IError | IIndir>) => {
  const accessToken = generation.verifyAccessToken(
    req.headers.authorization || req.cookies["access-token"]
  );
  if (!accessToken) {
    return res.status(400).send({ reason: "UNAVAILABLE_TOKEN" });
  }

  const { id } = accessToken;

  if (!reqlimit(pool, id, 1)) {
    res.status(400).send({ reason: "TOO_MANY_REQUESTS" });
    return;
  }

  if (!(await isCloudUser(id))) {
    res.status(400).send({ reason: "NOT_REGISTERED" });
    return;
  }

  const { path: relativePath, _program, nid } = req.query;
  const program = _program || "cloud";

  if (typeof relativePath != "string") {
    res.status(400).send({ reason: "UNAVAILABLE_PATH" });
    return;
  }
  let absolutePath: string;
  if (nid) {
    if (typeof nid !== "string") {
      res.status(400).send({ reason: "UNAVAILABLE_NID" });
      return;
    }
    const publicRelativePath = await getPublicPath(nid);

    if (!publicRelativePath) {
      res.status(400).send({ reason: "NOT_EXISTS" });
      return;
    }
    absolutePath = publicRelativePath;
  } else {
    if (typeof program !== "string" || !isValidProgram(program)) {
      res.status(400).send({ reason: "UNAVAILABLE_PROGRAM" });
      return;
    }

    absolutePath = path.join(env.cloud_path, id, program, relativePath);

    if (!isValidPath(id, program, absolutePath)) {
      res.status(400).send({ reason: "UNAVAILABLE_PATH" });
      return;
    }
  }
  if (!fs.existsSync(absolutePath)) {
    res.status(400).send({ reason: "NOT_EXISTS" });
    return;
  }

  try {
    const stat = fs.statSync(absolutePath);
    const { mtimeMs, birthtimeMs } = stat;
    res.status(200).send({
      isDir: stat.isDirectory(),
      mtimeMs: mtimeMs,
      birthtimeMs: birthtimeMs,
    });
  } catch (err) {
    console.error(err);
    res.status(400).send({ reason: "UNKNOWN_ERROR" });
  }
});
IndirRouter.delete("/indir", async (req, res: Response<IError | ISuccess>) => {
  const accessToken = generation.verifyAccessToken(
    req.headers.authorization || req.cookies["access-token"]
  );
  if (!accessToken) {
    return res.status(400).send({ reason: "UNAVAILABLE_TOKEN" });
  }

  const { id } = accessToken;

  if (!reqlimit(pool, id, 1)) {
    res.status(400).send({ reason: "TOO_MANY_REQUESTS" });
    return;
  }

  if (!(await isCloudUser(id))) {
    res.status(400).send({ reason: "NOT_REGISTERED" });
    return;
  }

  const { path: relativePath, program: _program } = req.body;
  const program = _program || "cloud";

  if (typeof relativePath != "string") {
    res.status(400).send({ reason: "UNAVAILABLE_PATH" });
    return;
  }
  if (typeof program !== "string" || !isValidProgram(program)) {
    res.status(400).send({ reason: "UNAVAILABLE_PROGRAM" });
    return;
  }
  const absolutePath = path.join(env.cloud_path, id, program, relativePath);

  if (
    !isValidPath(id, program, absolutePath) ||
    isPathMatch(absolutePath, path.join(env.cloud_path, id, program))
  ) {
    res.status(400).send({ reason: "UNAVAILABLE_PATH" });
    return;
  }
  if (!fs.existsSync(absolutePath)) {
    res.status(400).send({ reason: "NOT_EXISTS" });
  }

  try {
    deletePublicPath(absolutePath);

    const stat = fs.statSync(absolutePath);
    let capacity;
    if (stat.isDirectory()) {
      capacity = getPathCapacity(absolutePath);
    } else {
      capacity = stat.size;
    }

    fs.rmSync(absolutePath, { recursive: true });
    changeCapacity(id, capacity * -1);
    res.status(200).send({});
  } catch (err) {
    console.error(err);
    res.status(400).send({ reason: "UNKNOWN_ERROR" });
  }
});
IndirRouter.post("/mv", async (req, res: Response<IError | ISuccess>) => {
  const accessToken = generation.verifyAccessToken(
    req.headers.authorization || req.cookies["access-token"]
  );
  if (!accessToken) {
    return res.status(400).send({ reason: "UNAVAILABLE_TOKEN" });
  }

  const { id } = accessToken;

  if (!reqlimit(pool, id, 1)) {
    res.status(400).send({ reason: "TOO_MANY_REQUESTS" });
    return;
  }

  if (!(await isCloudUser(id))) {
    res.status(400).send({ reason: "NOT_REGISTERED" });
    return;
  }

  const {
    oldPath: relativeOldPath,
    oldProgram: _oldProgram,
    newPath: relativeNewPath,
    newProgram: _newProgram,
    keepPublic,
  } = req.body;
  const oldProgram = _oldProgram || "cloud";
  const newProgram = _newProgram || oldProgram;

  if (typeof relativeOldPath != "string") {
    res.status(400).send({ reason: "UNAVAILABLE_PATH" });
    return;
  }
  if (typeof oldProgram !== "string" || !isValidProgram(oldProgram)) {
    res.status(400).send({ reason: "UNAVAILABLE_PROGRAM" });
    return;
  }

  if (typeof relativeNewPath != "string") {
    res.status(400).send({ reason: "UNAVAILABLE_PATH" });
    return;
  }
  if (typeof newProgram !== "string" || !isValidProgram(newProgram)) {
    res.status(400).send({ reason: "UNAVAILABLE_PROGRAM" });
    return;
  }
  const absoluteOldPath = path.join(
    env.cloud_path,
    id,
    oldProgram,
    relativeOldPath
  );
  const absoluteNewPath = path.join(
    env.cloud_path,
    id,
    newProgram,
    relativeNewPath
  );

  if (
    !isValidPath(id, oldProgram, absoluteOldPath) ||
    isPathMatch(absoluteOldPath, path.join(env.cloud_path, id, oldProgram))
  ) {
    res.status(400).send({ reason: "UNAVAILABLE_PATH" });
    return;
  }
  if (
    !isValidPath(id, newProgram, absoluteNewPath) ||
    isPathMatch(absoluteNewPath, path.join(env.cloud_path, id, newProgram))
  ) {
    res.status(400).send({ reason: "UNAVAILABLE_PATH" });
    return;
  }
  if (!fs.existsSync(absoluteNewPath)) {
    res.status(400).send({ reason: "NOT_EXISTS" });
    return;
  }

  try {
    fs.renameSync(absoluteOldPath, absoluteNewPath);
    if (typeof keepPublic == "boolean" && keepPublic) {
      await renamePublicPath(absoluteOldPath, absoluteNewPath);
    } else {
      await deletePublicPath(absoluteOldPath);
    }
    res.status(200).send({});
  } catch (err) {
    console.error(err);
    res.status(400).send({ reason: "UNKNOWN_ERROR" });
  }
});

export default IndirRouter;
