import { PoolConnection } from "mysql";
import { fromdb, query } from "./db";
import { pool } from "./static";
import { andOperation, isEmpty } from "./bit";
import { Rank, getRankFromBuffer } from "./ranks";

interface IRankQuery {
  rank: Buffer;
}

const getRankDB = async (
  connection: PoolConnection,
  id: string
): Promise<Rank | null> => {
  const result = await query<IRankQuery>(
    connection,
    "SELECT rank FROM userRank WHERE id=?",
    [id]
  );
  if (result.length == 0) return null;
  return getRankFromBuffer(result[0].rank);
};
const getRank = fromdb(pool, getRankDB, null);

const isAdminDB = async (
  connection: PoolConnection,
  id: string
): Promise<boolean> => {
  const rank = await getRankDB(connection, id);
  if (rank) {
    return !isEmpty(
      andOperation(Buffer.from([rank]), Buffer.from([Rank.ADMIN]))
    );
  }
  return false;
};
const isAdmin = fromdb(pool, isAdminDB, false);

export { getRankDB, getRank, isAdminDB, isAdmin };
