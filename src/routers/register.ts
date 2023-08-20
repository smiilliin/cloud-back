import express, { Response } from "express";
import { getRankDB } from "@/rank";
import { Rank, hasRank } from "@/ranks";
import { IError, ISuccess, generation, pool } from "@/static";
import reqlimit from "@/reqlimit";
import { fromdb, isCloudUserDB, query } from "@/db";
import fs from "fs";
import { env } from "@/env";

const RegisterRouter = express.Router();

const createProgram = (id: string, name: string): void => {
  fs.mkdirSync(`${env.cloud_path}/${id}/${name}`);
};

interface IIsregistered {
  registered: boolean;
}
RegisterRouter.get("/", async (req, res: Response<IError | IIsregistered>) => {
  const accessToken = generation.verifyAccessToken(
    req.headers.authorization || req.cookies["access-token"]
  );
  if (!accessToken) {
    res.status(400).send({ reason: "UNAVAILABLE_TOKEN" });
    return;
  }

  const { id } = accessToken;

  if (!reqlimit(pool, id, 1)) {
    res.status(400).send({ reason: "TOO_MANY_REQUESTS" });
    return;
  }

  fromdb(
    pool,
    async (connection) => {
      if (await isCloudUserDB(connection, id)) {
        res.status(200).send({ registered: true });
        return;
      }
      res.status(400).send({ registered: false });
    },
    () => {
      res.status(400).send({ reason: "UNKNOWN_ERROR" });
    }
  )();
});
RegisterRouter.post("/", async (req, res: Response<IError | ISuccess>) => {
  const accessToken = generation.verifyAccessToken(
    req.headers.authorization || req.cookies["access-token"]
  );
  if (!accessToken) {
    res.status(400).send({ reason: "UNAVAILABLE_TOKEN" });
    return;
  }

  const { id } = accessToken;

  if (!reqlimit(pool, id, 1)) {
    res.status(400).send({ reason: "TOO_MANY_REQUESTS" });
    return;
  }

  fromdb(
    pool,
    async (connection) => {
      const rank = await getRankDB(connection, id);
      if (!rank || !hasRank(rank, Rank.CLOUD)) {
        res.status(400).send({ reason: "CANNOT_REGISTER" });
        return;
      }

      if (await isCloudUserDB(connection, id)) {
        res.status(400).send({ reason: "ALREADY_REGISTERED" });
        return;
      }

      if (!fs.existsSync(`${env.cloud_path}/${id}`)) {
        try {
          fs.mkdirSync(`${env.cloud_path}/${id}`);
          createProgram(id, "cloud");
        } catch {
          res.status(400).send({ reason: "UNKNOWN_ERROR" });
          return;
        }
      }

      await query(connection, "INSERT INTO cloudUser VALUES(?)", [id]);
      res.status(200).send({});
    },
    () => {
      res.status(400).send({ reason: "UNKNOWN_ERROR" });
    }
  )();
});

export default RegisterRouter;
