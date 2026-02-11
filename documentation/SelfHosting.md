# Self Hosting

Depending on your situation, it may be advantageous to self-host Rhenium whether for testing purposes or to try out a feature in an isolated instance.

You can get Rhenium up and running on a local machine in a few simple steps.

## 1. Create the `.env` file

Copy the contents of the `.env.example` file to a new `.env` file and fill in the values.

This file contains basic infrastructure-level configuration like the bot token and database connection strings.

Refer to the example file for the required values.

## 2. Create the `cfg.global.yml` file

Copy the contents of the `.cfg.example.yml` file to a new `.cfg.global.yml` file and fill in the values.

## 3. Set up the database tables

Use Prisma to automatically set up the database tables based on the pre-defined schemas.

```sh
bunx prisma db push
```

## 4. Start Rhenium

Start the Rhenium container

```sh
docker compose up -d
```
