"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const rest_1 = require("@octokit/rest");
const helpers = __importStar(require("./helpers"));
const process_1 = require("process");
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = require("fs");
dotenv_1.default.config();
const main = async () => {
    const { repos, endpoint, outdir } = helpers.acceptCommandLineArgs();
    await run(repos);
};
main();
async function run(repos) {
    const promises = [];
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
        console.log(`Created directory ${directory}`);
    }
    else {
        console.log(`Directory ${directory} already exists`);
    }
    repos.forEach((repo) => {
        promises.push(startOrgMigration(repo.org, repo.repo));
    });
    const migrations = await Promise.all(promises);
    console.log(migrations);
    await checkMigrationStatus(migrations);
    // await downloadMigrationArchive(migrations);
}
// async function to call api.github.com/status
async function startOrgMigration(org, repo) {
    const octokit = new rest_1.Octokit({
        auth: process_1.env.GITHUB_TOKEN,
        baseUrl: process_1.env.GITHUB_ENDPOINT
    });
    let migration_id;
    try {
        const response = await octokit.request('POST /orgs/{org}/migrations', {
            org: org,
            repositories: [repo],
            lock_repositories: true
        });
        migration_id = response.data.id;
    }
    catch (error) {
        console.log("ERROR" + error);
    }
    return { org, migration_id };
}
async function checkMigrationStatus(migrationIds) {
    const octokit = new rest_1.Octokit({
        auth: process_1.env.GITHUB_TOKEN,
        baseUrl: process_1.env.GITHUB_ENDPOINT
    });
    const promises = [];
    migrationIds.forEach((migrationId) => {
        promises.push(checkSingleMigrationStatus(migrationId, octokit));
    });
    return Promise.all(promises).then((values) => {
        console.log(values);
    });
}
async function checkSingleMigrationStatus(migrationId, octokit) {
    let migrationStatus;
    let attempts = 0;
    const maxAttempts = 10;
    const delay = 10000;
    while (true) {
        try {
            const response = await octokit.request(`GET /orgs/{org}/migrations/${migrationId.migration_id.toString()}`, {
                org: migrationId.org,
                migration_id: migrationId.migration_id
            });
            migrationStatus = response.data.state;
        }
        catch (error) {
            console.log(`ERROR: Failed to get status for migration ${migrationId.migration_id}.`);
            console.log(error);
            migrationStatus = "Unknown";
        }
        console.log(`Migration ${migrationId.migration_id} status: ${migrationStatus}.`);
        if (migrationStatus === "exported") {
            const filePath = `archive/migration_archive_${migrationId.migration_id}.tar.gz`;
            console.log(`Migration ${migrationId.migration_id} is complete.`);
            console.log(`Downloading migration ${migrationId.migration_id} archive to ${filePath}.`);
            const response = await octokit.request('GET /orgs/{org}/migrations/{migration_id}/archive', {
                org: migrationId.org,
                migration_id: migrationId.migration_id
            });
            const fileStream = (0, fs_1.createWriteStream)(filePath);
            fileStream.write(Buffer.from(response.data));
            fileStream.end();
            console.log(`Migration ${migrationId.migration_id} archive downloaded to ${filePath}.`);
            return { migrationId: migrationId.migration_id, migrationStatus: migrationStatus };
        }
        else {
            attempts++;
            if (attempts >= maxAttempts) {
                console.log(`ERROR: Maximum number of attempts (${maxAttempts}) reached for migration ${migrationId.migration_id}.`);
                return { migrationId: migrationId.migration_id, migrationStatus };
            }
            else {
                console.log(`Waiting ${delay / 1000} seconds before checking migration status again.`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
}
async function downloadMigrationArchive(org, migrationId, filePath) {
    const octokit = new rest_1.Octokit({
        auth: process_1.env.GITHUB_TOKEN,
        baseUrl: process_1.env.GITHUB_ENDPOINT
    });
    const { data } = await octokit.request('GET /orgs/{org}/migrations/{migration_id}/archive', {
        org: org,
        migration_id: migrationId
    });
    const fileStream = (0, fs_1.createWriteStream)(filePath);
    fileStream.write(data);
    fileStream.end();
}
