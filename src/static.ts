import TokenGeneration from "token-generation";
import fs from "fs";
import mysql from "mysql";
import { env } from "./env";
import en from "./strings/en.json";

const hmacKey = Buffer.from(fs.readFileSync("../hmacKey").toString(), "hex");

const pool = mysql.createPool({
  host: env.db_host,
  user: env.db_user,
  password: env.db_password,
  database: env.db_database,
});
const generation = new TokenGeneration(pool, hmacKey);

export { pool, generation };

interface IError {
  reason: keyof typeof en;
}
interface ISuccess {}

export { IError, ISuccess };
