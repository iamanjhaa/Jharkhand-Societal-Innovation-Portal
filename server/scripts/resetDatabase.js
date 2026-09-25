import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

import User from '../models/User.js';
import Challenge from '../models/Challenge.js';
import Project from '../models/Project.js';
import Collaboration from '../models/Collaboration.js';
import ClubActivity from '../models/ClubActivity.js';
import Notification from '../models/Notification.js';
import RewardRedemption from '../models/RewardRedemption.js';
import Sponsorship from '../models/Sponsorship.js';
import UniversityCoordinatorCode from '../models/UniversityCoordinatorCode.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const uploadsDirectory = path.resolve(projectRoot, 'server', 'uploads');

dotenv.config({ path: path.resolve(projectRoot, '.env') });

const applicationModels = [
  Notification,
  RewardRedemption,
  Sponsorship,
  ClubActivity,
  Collaboration,
  Project,
  Challenge,
  UniversityCoordinatorCode,
  User,
];

const countUploadedFiles = async (directory) => {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    let count = 0;

    for (const entry of entries) {
      if (entry.name === '.gitignore') {
        continue;
      }

      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        count += await countUploadedFiles(entryPath);
      } else if (entry.isFile()) {
        count += 1;
      }
    }

    return count;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
};

const removeUploadedFiles = async (directory) => {
  let removed = 0;
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.gitignore') {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      removed += await removeUploadedFiles(entryPath);
    } else if (entry.isFile()) {
      await fs.unlink(entryPath);
      removed += 1;
    }
  }

  return removed;
};

const formatNumber = (value) => value.toLocaleString('en-US');

const resetDatabase = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not defined in the project-root .env file');
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const database = mongoose.connection.db;
  const databaseName = database.databaseName;
  const existingCollections = await database.listCollections({}, { nameOnly: true }).toArray();
  const existingCollectionNames = new Set(existingCollections.map(({ name }) => name));
  const applicationCollections = [...new Set(applicationModels.map((model) => model.collection.name))].sort();
  const affectedCollections = applicationCollections.filter((name) => existingCollectionNames.has(name));

  console.log(`Database: ${databaseName}`);
  console.log('\nApplication collections discovered from Mongoose models:');
  for (const collectionName of applicationCollections) {
    console.log(`- ${collectionName}${affectedCollections.includes(collectionName) ? '' : ' (not present)'}`);
  }
  console.log('\nExisting application collections that will be affected:');
  for (const collectionName of affectedCollections) {
    console.log(`- ${collectionName}`);
  }

  const collectionCounts = [];
  for (const collectionName of applicationCollections) {
    const count = existingCollectionNames.has(collectionName)
      ? await database.collection(collectionName).countDocuments()
      : 0;
    collectionCounts.push({ collectionName, count });
  }

  console.log('\nCollections and document counts before reset:');
  for (const { collectionName, count } of collectionCounts) {
    console.log(`- ${collectionName}: ${formatNumber(count)}`);
  }

  const uploadedBefore = await countUploadedFiles(uploadsDirectory);
  console.log(`\nUploaded application files before reset: ${formatNumber(uploadedBefore)}`);

  if (process.env.RESET_DATABASE_CONFIRM !== 'YES') {
    console.log(
      '\nStop the backend before the destructive reset so it cannot create new records during cleanup.',
    );
    console.error(
      '\nNo data was deleted. Set RESET_DATABASE_CONFIRM=YES and run this command again to perform the one-time reset.',
    );
    return;
  }

  console.log('\nRESET_DATABASE_CONFIRM=YES received. Deleting application data...');

  const results = [];
  for (const { collectionName, count: before } of collectionCounts) {
    let deleted = 0;
    if (before > 0) {
      const deletion = await database.collection(collectionName).deleteMany({});
      deleted = deletion.deletedCount;
    }

    const remaining = await database.collection(collectionName).countDocuments();
    results.push({ collectionName, before, deleted, remaining });
  }

  const uploadedRemoved = uploadedBefore > 0
    ? await removeUploadedFiles(uploadsDirectory)
    : 0;
  const uploadedRemaining = await countUploadedFiles(uploadsDirectory);

  console.log('\nReset results:');
  for (const { collectionName, before, deleted, remaining } of results) {
    console.log(
      `- ${collectionName}: before=${formatNumber(before)}, deleted=${formatNumber(deleted)}, remaining=${formatNumber(remaining)}`,
    );
  }
  console.log(
    `- uploaded files: before=${formatNumber(uploadedBefore)}, removed=${formatNumber(uploadedRemoved)}, remaining=${formatNumber(uploadedRemaining)}`,
  );

  const remainingDocuments = results.reduce((total, result) => total + result.remaining, 0);
  if (remainingDocuments !== 0 || uploadedRemaining !== 0) {
    throw new Error('Reset verification failed: application data remains');
  }

  await mongoose.connection.db.command({ ping: 1 });
  console.log(`\nMongoDB connection verified for database: ${databaseName}`);
  console.log('Application database reset completed successfully.');
};

try {
  await resetDatabase();
} catch (error) {
  console.error(`\nDatabase reset failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
