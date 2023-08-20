import dotenv from "dotenv";

dotenv.config();

const env = {
  db_host: process.env.DB_HOST as string,
  db_user: process.env.DB_USER as string,
  db_password: process.env.DB_PASSWORD as string,
  db_database: process.env.DB_DATABASE as string,
  port: Number(process.env.PORT),
  cloud_path: process.env.CLOUD_PATH as string,
  max_path_length: Number(process.env.MAX_PATH_LENGTH),
  max_indir_length: Number(process.env.MAX_INDIR_LENGTH),
  max_program_length: Number(process.env.MAX_PROGRAM_LENGTH),
  sleep_timeout: Number(process.env.SLEEP_TIMEOUT),
  max_cloud_capacity: Number(process.env.MAX_CLOUD_CAPACITY),
};

for (const [key, value] of Object.entries(env)) {
  if (value === undefined || (typeof value == "number" && isNaN(value))) {
    throw new Error(`${key} not defined`);
  }
}

export { env };
