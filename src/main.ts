import { Octokit } from "@octokit/rest";
import dotenv from "dotenv"
import { createWriteStream, existsSync, mkdirSync } from "fs";
import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { unlinkSync } from "fs";
import { promisify } from "util";
const yargs = require('yargs')
import logger from './logger';

interface MaybeQueuedMigration {
    org: string;
    repo: string;
    migrationId: number | undefined;
}

interface QueuedMigration {
    migrationId: number;
    org: string;
    repo: string;
}

interface MigrationWithStatus {
    migrationId: number;
    org: string;
    repo: string;
    migrationStatus: string;
}

const main = async () => {
    dotenv.config();
    const { repos, endpoint, outdir, production, token, azureBlobStorageConnectionString, azureBlobStorageContainerName } = acceptCommandLineArgs();
    await run(repos, endpoint, outdir, production, token, azureBlobStorageConnectionString, azureBlobStorageContainerName);
};

// The main entrypoint for the application
main();

async function run(repos: any, endpoint: string, outdir: string, production: boolean, token: string, azureStorageConnectionString: string | undefined, azureBlobStorageContainerName: string) {
    const promises: any = [];
    // Check if archive output dir already exists
    let message: string = `Directory ${outdir} already exists`
    if (!existsSync(outdir)) {
        mkdirSync(outdir, { recursive: true });
        message = `Created directory ${outdir}`
    }
    logger.info(message)
    const octokit = new Octokit({
        auth: token,
        baseUrl: endpoint
    })

    let containerClient: ContainerClient | undefined = undefined;

    if (azureStorageConnectionString) {
        const blobServiceClient = BlobServiceClient.fromConnectionString(azureStorageConnectionString);

        try {
            await blobServiceClient.getProperties();
        } catch (error) {
            logger.error(`Failed to connect to Azure Blob Storage using connection string ${azureStorageConnectionString}.`);
            logger.error(error);
            process.exit(1);
        }

        containerClient = blobServiceClient.getContainerClient(azureBlobStorageContainerName);        
    }

    repos.forEach((repo: any) => {
        promises.push(startOrgMigration(repo.org, repo.repo, octokit, production));
    });
    const migrations: MaybeQueuedMigration[] = await Promise.all(promises);
    logger.debug(migrations);
    const queuedMigrations = migrations.filter((migration: MaybeQueuedMigration) => migration.migrationId !== undefined) as QueuedMigration[];
    await checkMigrationStatus(queuedMigrations, outdir, octokit, containerClient);
}

async function startOrgMigration(org: string, repo: string, octokit: Octokit, production: boolean): Promise<MaybeQueuedMigration> {
    let migrationId: number | undefined;
    const jitterMax = 5000; // upper bound for jitter 
    const delay = Math.floor(Math.random() * jitterMax);
    setTimeout(function(){
        logger.info(`Starting migration for ${org}/${repo}`)
    }, delay);
    try {

        const response = await octokit.request('POST /orgs/{org}/migrations', {
            org: org,
            repositories: [repo],
            lock_repositories: production
        })
        migrationId = response.data.id;
    } catch (error) {
        logger.error(`Failed to start migration for ${org}/${repo}.`);
        logger.error(error);
    }
    return { org, repo, migrationId: migrationId };
}

async function checkMigrationStatus(migrations: QueuedMigration[], outdir: string, octokit: Octokit, containerClient: ContainerClient | undefined) {
    const promises: any = [];
    migrations.forEach(migration => {
        promises.push(checkStatusAndHandleArchive(migration, outdir, octokit, containerClient));
    });

    return Promise.all(promises).then((values: MigrationWithStatus[]) => {
        logger.info(JSON.stringify(values));
    });
}

async function checkStatusAndHandleArchive(migration: QueuedMigration, outdir: string, octokit: Octokit, containerClient: ContainerClient | undefined): Promise<MigrationWithStatus> {
    /**
     * 
     */
    let migrationStatus: string;
    let attempts = 0;
    const maxAttempts = 180;
    const delayInMilliseconds = 60 * 1000;
    while (true) {
        try {
            const response = await octokit.request(`GET /orgs/{org}/migrations/${migration.migrationId.toString()}`, {
                org: migration.org,
                migration_id: migration.migrationId
            });
            migrationStatus = response.data.state;
        } catch (error) {
            logger.error(`Failed to get status for migration ${migration.migrationId}.`);
            logger.error(error);
            migrationStatus = "Unknown";
        }

        logger.info(`Migration ${migration.migrationId} status: ${migrationStatus}.`);

        if (migrationStatus === "exported") {
            const fileName = `migration_archive_${migration.migrationId}.tar.gz`;
            const filePath = `${outdir}/${fileName}`;
            logger.info(`Migration ${migration.migrationId} is complete.`);
            logger.info(`Downloading migration ${migration.migrationId} archive to ${filePath}.`)
            const response = await octokit.request<any>('GET /orgs/{org}/migrations/{migration_id}/archive', {
                org: migration.org,
                migration_id: migration.migrationId
            })
            const fileStream = createWriteStream(filePath);
            fileStream.write(Buffer.from(response.data));
            fileStream.end();
            await promisify(fileStream.close).bind(fileStream)();
            logger.info(`Migration ${migration.migrationId} archive downloaded to ${filePath}.`)

            if (containerClient) {
                logger.info(`Uploading migration ${migration.migrationId} archive to Azure Blob Storage as ${filePath}.`);
                const blockBlobClient = containerClient.getBlockBlobClient(fileName);
                await blockBlobClient.uploadFile(filePath, {
                    tags: {
                        owner: migration.org,
                        repo: migration.repo
                    }
                });
                logger.info(`Finished uploading migration ${migration.migrationId} archive to Azure Blob Storage.`);
                unlinkSync(filePath);
                logger.info(`Deleted migration ${migration.migrationId} archive from local storage`);
            }

            return { ...migration, migrationStatus };
        } else if (migrationStatus === "failed") {
            logger.error(`Archive generation failed for migration ${migration.migrationId}.`);
            return { ...migration, migrationStatus };
        } else {
            attempts++;
            if (attempts >= maxAttempts) {
                logger.error(`Maximum number of attempts (${maxAttempts}) reached for migration ${migration.migrationId}.`);
                return { ...migration, migrationStatus };
            } else {
                logger.info(`Waiting ${delayInMilliseconds / 1000} seconds before checking migration status again.`);
                await new Promise(resolve => setTimeout(resolve, delayInMilliseconds));
            }
        }
    }
}

export function acceptCommandLineArgs(): { 
    repos: { org: string, repo: string }[], 
    endpoint: string, 
    outdir: string, 
    production: boolean,
    token: string,
    azureBlobStorageConnectionString: string | undefined, 
    azureBlobStorageContainerName: string,
} { const argv = yargs.default(process.argv.slice(2))
        .env('GITHUB')
        .option('repos', {
            alias: 'r',
            env: 'GITHUB_REPOS',
            description: 'Comma delimited list of orgs/repos (ex. github/github,torvalds/linux)',
            type: 'string',
            demandOption: true,
        })
        .option('endpoint', {
            alias: 'e',
            env: 'GITHUB_ENDPOINT',
            description: 'The api endpoint of the github instance (ex. api.github.com)',
            type: 'string',
            demandOption: true,
        })
        .option('outdir', {
            alias: 'o',
            env: 'GITHUB_OUTDIR',
            description: 'The output directory for the files. (ex. archives)',
            type: 'string',
            default: "archives",
            demandOption: false,
        })
        .option('production', {
            alias: 'p',
            env: 'GITHUB_PRODUCTION',
            description: 'Defines whether this is a production migration (locks the source repos).',
            type: 'boolean',
            default: false,
            demandOption: false,
        })
        .option('azureBlobStorageConnectionString', {
            alias: 'b',
            env: 'AZURE_BLOB_STORAGE_CONNECTION_STRING',
            description: 'The connection string used to connect to Azure Blob Storage. If this is set, archives will be uploaded to Azure Blob Storage as they are downloaded and will be deleted from the local filesystem.',
            type: 'string',
            demandOption: false
        })
        .option('azureBlobStorageContainerName', {
            alias: 'c',
            env: 'AZURE_BLOB_STORAGE_CONTAINER_NAME',
            description: 'The name of the container to upload archives to. If this is not set, the container name will default to "migration-archives".',
            type: 'string',
            default: "migration-archives",
            demandOption: false
        })
        .option('authToken', {
            alias: 't',
            env: 'GITHUB_AUTH_TOKEN',
            description: 'The personal access token for the GHES Migration API.',
            type: 'string',
            demandOption: true,
        }).argv;
    let repoObjs: { org: string, repo: string }[] = [];
    argv.repos.split(",").forEach((repo: string) => {
        repoObjs.push({
            org: repo.split("/")[0].trim(),
            repo: repo.split("/")[1].trim()
        })
    });
    return { repos: repoObjs, endpoint: argv.endpoint, outdir: argv.outdir, production: argv.production, token: argv.authToken, azureBlobStorageConnectionString: argv.azureBlobStorageConnectionString, azureBlobStorageContainerName: argv.azureBlobStorageContainerName };
}
