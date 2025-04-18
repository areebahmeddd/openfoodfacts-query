# Open Food Facts Query Engine

This project extracts key product data from MongoDB into a Postgres database in order to support faster aggregate calculations

# Development

## Running locally

When running locally the project expects a Postgres database to be available on port 5512 and a Mongo database on port 27017, both on localhost. Running docker-compose will create a suitable Postgres database if needed. The database name can be set in the environment, but the schema name is always "query".

To get started...

### Create a Postgres database in Docker

Run the following:

```
docker compose up -d query_postgres
```

### Use an existing Postgres database

Update the POSTGRES_HOST (and other necessary) environment variables to reference your existing database.

Please use the `.envrc` file to override settings so that edits are not committed to the repo.

When connecting to a PostgreSQL database running on a Windows host from a WSL2 instance you will need to enable the PostgreSQL port (5432) in Windows Firewall.

### Prepare for development

Run the following:

```
npm install
npm run migration:up
```

You can then start in watch mode with:

```
npm run start:dev
```

The service is exposed on port 5510, to avoid clashing with Robotoff.

## Project Structure

The project uses the [NestJS](https://docs.nestjs.com/) framework with [Mikro-ORM](https://mikro-orm.io/docs/installation).

The entrypoint is main.js which runs database migrations and starts the service.

The main business logic is in the domain/services folder and the controllers route through to here. Extensive use is made of the Mikro-ORM [EntityManager](https://mikro-orm.io/docs/entity-manager) here to interact with the database, although in some cases more raw SQL is used to optimise performance.

The domain/entities folder defines the main entities and is used to automatically generate migrations using the [migration:create](https://mikro-orm.io/docs/migrations#initial-migration) npm task.

## Testing

The unit tests use testcontainers to create a temporary Postgres database in Docker, which lasts for the duration of the test run. The tests share the same database while running, so ensure that tests are independant from one another by using randmoised product codes / tags.

## Calling from Product Opener

By default, product opener is configured to call the "query" host on the "po_default" network. To configure Product Opener to use a locally running instance update the following line in the Product Opener .env file:

```
QUERY_URL=http://host.docker.internal:5510
```

## Running in Docker

The project joins the Product Opener "po_default" network.

The project still uses its own Postgres database but will connect to shared-services Mongo database using the "mongodb" host.

The service is exposed to localhost on 5511 to avoid clashing with any locally running instance.

Use docker compose to start:

```
docker-compose up -d --build
```

## Adding new tags

Support for new tags can be done by simply adding a further entity definition in the product-tags.ts file.

The tag won't be picked up for queries until a full import is done (when it will be added to the loaded_tag table).

# Deployment vs Development

The main docker-compose.yml creates the openfoodfacts-query service and associated Postres database and expects MongoDB to already exist.

The dev.yml Docker Compose joins the services to the po_default network to ease communication with Product Opener and MongoDB. In staging and production comminication with MongoDB is done with an explicit network address.

# Use

## Import from Mongo

The `make refresh_product_tags` command from Product Opener will refresh the Query Postgres database with the current tags from MongoDB. This can also be invoked from a browser with:

```
http://localhost:5510/importfrommongo?from
```

The "from" option ensures that an incremental import is performed. If no date is supplied then the query service will look at the latest modified time for products it already has and only fetch products from MongoDB that have been modified since then. An explicit date can also be specified in the from parameter, e.g. "from=2023-02-23". If no from parameter is applied then all data in the Postgres database will be deleted and a full import will be performed.

## Import from File

There is also an importfromfile endpoint which will import from a file called openfoodfacts-products.jsonl in the data directory. This local folder is mapped to the container in dev.yml.

## Performing queries

The "count" and "aggregate" POST endpoints accept a MongoDB style filter and aggregate pipeline respectively. Syntax support is only basic and is limted to what Product Opener currently uses. See the tests for some examples of what is supported.

You can test with curl with something like:
```bash
# selection
curl -d '{"categories_tags": "en:teas"}' -H "Content-Type: application/json" https://query.openfoodfacts.org/select
# aggergation
curl -d '[{"$match": {"countries_tags": "en:france"}},{"$group":{"_id":"$brands_tags"}}]' -H "Content-Type: application/json" https://query.openfoodfacts.org/aggregate
```


