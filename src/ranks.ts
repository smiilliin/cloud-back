import { andOperation, isEmpty } from "./bit";

// const rankSize = 8;

// Buffer.alloc(rankSize)
enum Rank {
  ADMIN = 1 << 0,
  SUPERTHANKS = 1 << 1,
  CLOUD = 1 << 2,
}

const hasRank = (userRank: Rank, rank: Rank): boolean => {
  return !isEmpty(andOperation(Buffer.from([userRank]), Buffer.from([rank])));
};
const allRanksString = Object.keys(Rank).filter((key) => isNaN(Number(key)));
const allRanks = allRanksString.map((v) => Rank[v as keyof typeof Rank]);
const getRankStrings = (rank: Rank): Array<string> => {
  return allRanksString.filter((v) =>
    hasRank(rank, Rank[v as keyof typeof Rank])
  );
};
const getRankFromBuffer = (rankBuffer: Buffer): Rank => {
  const rankValues = Object.values(Rank).filter(
    (val) => typeof val === "number"
  ) as number[];

  let result = 0;
  rankValues.forEach((rank) => {
    if (!isEmpty(andOperation(rankBuffer, Buffer.from([rank])))) {
      result |= rank;
    }
  });

  return result as Rank;
};

export {
  hasRank,
  getRankStrings,
  Rank,
  allRanks,
  allRanksString,
  getRankFromBuffer,
};
