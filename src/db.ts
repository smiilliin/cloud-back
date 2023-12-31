import { Pool, PoolConnection } from "mysql";
import { pool } from "./static";
import { getNormalizedPath } from ".";
import { nanoid } from "nanoid";

const getConnection = (pool: Pool): Promise<PoolConnection> => {
  return new Promise((resolve, reject) => {
    pool.getConnection((err, connection) => {
      if (err) {
        connection?.release();
        return reject(err);
      }
      resolve(connection);
    });
  });
};
const query = <T>(
  connection: PoolConnection,
  q: string,
  values?: unknown
): Promise<Array<T>> => {
  return new Promise((resolve, reject) => {
    connection.query(q, values, (err, result: Array<T>) => {
      if (err) {
        return reject(err);
      }
      resolve(result);
    });
  });
};
const fromdb = <T, I extends unknown[]>(
  pool: Pool,
  dbFun: (connection: PoolConnection, ...options: I) => Promise<T>,
  defaultResult?: T | (() => T)
): ((...options: I) => Promise<T>) => {
  return async (...options: I) => {
    let connection: PoolConnection | undefined;

    try {
      connection = await getConnection(pool);

      return await dbFun(connection, ...options);
    } catch (err) {
      console.error(err);
      if (typeof defaultResult === "function")
        return (defaultResult as () => T)();
      return defaultResult as T;
    } finally {
      connection?.release();
    }
  };
};

export { getConnection, query, fromdb };

const isCloudUserDB = async (connection: PoolConnection, id: string) => {
  return (
    (await query(connection, "SELECT * FROM cloudUser WHERE id=?", [id]))
      .length !== 0
  );
};
const isCloudUser = fromdb(pool, isCloudUserDB, false);

interface IGetCapacityQuery {
  capacity: number;
}
const getCapacityDB = async (
  connection: PoolConnection,
  id: string
): Promise<number | undefined> => {
  const result = await query<IGetCapacityQuery>(
    connection,
    "SELECT capacity FROM cloudCapacityUser WHERE id=?",
    [id]
  );
  if (result.length == 0) return undefined;

  return result[0].capacity;
};
const getCapacity = fromdb(pool, getCapacityDB, undefined);

const setCapacityDB = async (
  connection: PoolConnection,
  id: string,
  capacity: number
): Promise<void> => {
  await query(
    connection,
    "INSERT into cloudCapacityUser (id, capacity) VALUES(?, ?) ON DUPLICATE KEY UPDATE capacity=?;",
    [id, capacity, capacity]
  );
};
const setCapacity = fromdb(pool, setCapacityDB);

const changeCapacityDB = async (
  connection: PoolConnection,
  id: string,
  change: number
): Promise<void> => {
  await query(
    connection,
    "UPDATE cloudCapacityUser SET capacity=capacity+? WHERE id=?",
    [change, id]
  );
};
const changeCapacity = fromdb(pool, changeCapacityDB, undefined);
interface IGetPublicQuery {
  path: Buffer;
}
const getPublicPathDB = async (
  connection: PoolConnection,
  nid: string
): Promise<string | undefined> => {
  const result = await query<IGetPublicQuery>(
    connection,
    "SELECT path FROM cloudPublic WHERE nid=?",
    [nid]
  );
  if (result.length == 0) return undefined;
  return result[0].path.toString("utf-8");
};
const getPublicPath = fromdb(pool, getPublicPathDB, undefined);
const deletePublicPathDB = async (
  connection: PoolConnection,
  absolutePath: string
): Promise<boolean | undefined> => {
  const normalizedAbsolutePath = getNormalizedPath(absolutePath);
  await query(
    connection,
    "DELETE FROM cloudPublic WHERE (path LIKE ? OR path=?)",
    [normalizedAbsolutePath.replace(/%/g, "\\%") + "%", normalizedAbsolutePath]
  );
  return true;
};
const deletePublicPath = fromdb(pool, deletePublicPathDB, undefined);
const renamePublicPathDB = async (
  connection: PoolConnection,
  absoluteOldPath: string,
  absoluteNewPath: string
): Promise<boolean | undefined> => {
  const normalizedOldAbsolutePath = getNormalizedPath(absoluteOldPath);
  const normalizedNewAbsolutePath = getNormalizedPath(absoluteNewPath);
  await query(connection, "UPDATE cloudPublic SET path=REPLACE(path, ?, ?)", [
    normalizedOldAbsolutePath,
    normalizedNewAbsolutePath,
  ]);
  return true;
};
const renamePublicPath = fromdb(pool, renamePublicPathDB, undefined);
const deletePublicNIDDB = async (
  connection: PoolConnection,
  id: string,
  nid: string
): Promise<boolean | undefined> => {
  await query(connection, "DELETE FROM cloudPublic WHERE id=? AND nid=?", [
    id,
    nid,
  ]);
  return true;
};
const deletePublicNID = fromdb(pool, deletePublicNIDDB, undefined);
const postPublicPathDB = async (
  connection: PoolConnection,
  id: string,
  absolutePath: string
): Promise<string> => {
  const nid = nanoid();
  await query<IGetPublicQuery>(
    connection,
    "INSERT INTO cloudPublic VALUES(?, ?, ?)",
    [id, getNormalizedPath(absolutePath), nid]
  );
  return nid;
};
const postPublicPath = fromdb(pool, postPublicPathDB, undefined);
interface IGetPathFromNIDQuery {
  path: string;
}
const getPathFromNIDDB = async (
  connection: PoolConnection,
  id: string,
  nid: string
): Promise<string> => {
  const { path } = (
    await query<IGetPathFromNIDQuery>(
      connection,
      "SELECT path INTO cloudPublic WHERE id=? AND nid=?",
      [id, nid]
    )
  )[0];
  return path;
};
const getPathFromNID = fromdb(pool, getPathFromNIDDB, undefined);

export {
  postPublicPathDB,
  postPublicPath,
  deletePublicNID,
  deletePublicNIDDB,
  deletePublicPath,
  deletePublicPathDB,
  getPublicPath,
  getPublicPathDB,
  getCapacity,
  getCapacityDB,
  changeCapacity,
  isCloudUser,
  isCloudUserDB,
  setCapacity,
  setCapacityDB,
  renamePublicPathDB,
  renamePublicPath,
  getPathFromNID,
  getPathFromNIDDB,
};
