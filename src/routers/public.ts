import {
  deletePublicNID,
  getPathFromNID,
  isCloudUser,
  postPublicPath,
} from "@/db";
import reqlimit from "@/reqlimit";
import { IError, ISuccess, generation, pool } from "@/static";
import express, { Response } from "express";
import { isValidPath, isValidProgram } from "..";
import path from "path";
import fs from "fs";
import { env } from "@/env";

const PublicRouter = express.Router();

interface IPostPublic {
  nid: string;
}
PublicRouter.post("/", async (req, res: Response<IError | IPostPublic>) => {
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

  const { program: _program, path: relativePath } = req.query;
  const program = _program || "cloud";

  if (typeof program !== "string" || !isValidProgram(program)) {
    res.status(400).send({ reason: "UNAVAILABLE_PROGRAM" });
    return;
  }
  if (typeof relativePath != "string") {
    res.status(400).send({ reason: "UNAVAILABLE_PATH" });
    return;
  }

  const absolutePath = path.join(env.cloud_path, id, program, relativePath);

  if (!isValidPath(id, program, absolutePath)) {
    res.status(400).send({ reason: "UNAVAILABLE_PATH" });
    return;
  }

  if (!fs.existsSync(absolutePath)) {
    res.status(400).send({ reason: "NOT_EXISTS" });
    return;
  }

  const nid = await postPublicPath(id, absolutePath);
  if (!nid) {
    res.status(400).send({ reason: "UNKNOWN_ERROR" });
    return;
  }
  res.status(200).send({ nid: nid });
});
PublicRouter.delete("/", async (req, res: Response<IError | ISuccess>) => {
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

  const { nid } = req.query;

  if (typeof nid != "string") {
    res.status(400).send({ reason: "UNAVAILABLE_NID" });
    return;
  }

  const result = await deletePublicNID(id, nid);
  if (!result) {
    res.status(400).send({ reason: "UNKNOWN_ERROR" });
    return;
  }
  res.status(200).send({});
});
interface IGetDirFromPublic {
  dir: string;
}
PublicRouter.get(
  "/dir",
  async (req, res: Response<IError | IGetDirFromPublic>) => {
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

    const { nid } = req.query;

    if (typeof nid != "string") {
      res.status(400).send({ reason: "UNAVAILABLE_NID" });
      return;
    }

    let dir = await getPathFromNID(id, nid);
    const homePath = path.join(env.cloud_path, id);
    if (!dir.startsWith(homePath)) {
      res.status(400).send({ reason: "UNKNOWN_ERROR" });
      return;
    }
    dir = dir.slice(homePath.length);

    res.status(200).send({ dir: dir });
  }
);

export default PublicRouter;
