// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { TSDocConfigFile } from '@microsoft/tsdoc-config';
import * as path from 'path';

import { Debug } from './Debug';

interface ICachedConfig {
  loadTimeMs: number;
  lastCheckTimeMs: number;
  configFile: TSDocConfigFile;
}

// How often to check for modified input files.  If a file's modification timestamp has changed, then we will
// evict the cache entry immediately.
const CACHE_CHECK_INTERVAL_MS: number = 3 * 1000;

// Evict old entries from the cache after this much time, regardless of whether the file was detected as being
// modified or not.
const CACHE_EXPIRE_MS: number = 20 * 1000;

// If this many objects accumulate in the cache, then it is cleared to avoid a memory leak.
const CACHE_MAX_SIZE: number = 100;

export class ConfigCache {
  // findConfigPathForFolder() result --> loaded tsdoc.json configuration
  private static _cachedConfigs: Map<string, ICachedConfig> = new Map<string, ICachedConfig>();
  private static _cachedPaths: Map<string, string> = new Map();

  /**
   * Node.js equivalent of performance.now().
   */
  private static _getTimeInMs(): number {
    const [seconds, nanoseconds] = process.hrtime();
    return seconds * 1000 + nanoseconds / 1000000;
  }

  public static getForSourceFile(
    sourceFilePath: string,
    tsConfigRootDir?: string | undefined
  ): TSDocConfigFile {
    const sourceFileFolder: string = path.dirname(path.resolve(sourceFilePath));

    // First, determine the file to be loaded. If not found, the configFilePath will be an empty string.
    // If the eslint config has specified where the tsconfig file is, use that path directly without probing the filesystem.
    const configFilePath: string = tsConfigRootDir
      ? path.join(tsConfigRootDir, TSDocConfigFile.FILENAME)
      : TSDocConfigFile.findConfigPathForFolder(sourceFileFolder);

    // If configFilePath is an empty string, then we'll use the folder of sourceFilePath as our cache key
    // (instead of an empty string)
    const cacheKey: string = configFilePath || sourceFileFolder + '/';
    Debug.log(`Cache key: "${cacheKey}"`);

    const nowMs: number = ConfigCache._getTimeInMs();

    let cachedConfig: ICachedConfig | undefined = undefined;

    // Do we have a cached object?
    cachedConfig = ConfigCache._cachedConfigs.get(cacheKey);

    if (cachedConfig) {
      Debug.log('Cache hit');

      // Is the cached object still valid?
      const loadAgeMs: number = nowMs - cachedConfig.loadTimeMs;
      const lastCheckAgeMs: number = nowMs - cachedConfig.lastCheckTimeMs;

      if (loadAgeMs > CACHE_EXPIRE_MS || loadAgeMs < 0) {
        Debug.log('Evicting because item is expired');
        cachedConfig = undefined;
        ConfigCache._cachedConfigs.delete(cacheKey);
      } else if (lastCheckAgeMs > CACHE_CHECK_INTERVAL_MS || lastCheckAgeMs < 0) {
        Debug.log('Checking for modifications');
        cachedConfig.lastCheckTimeMs = nowMs;
        if (cachedConfig.configFile.checkForModifiedFiles()) {
          // Invalidate the cache because it failed to load completely
          Debug.log('Evicting because item was modified');
          cachedConfig = undefined;
          ConfigCache._cachedConfigs.delete(cacheKey);
        }
      }
    }

    // Load the object
    if (!cachedConfig) {
      if (ConfigCache._cachedConfigs.size > CACHE_MAX_SIZE) {
        Debug.log('Clearing cache');
        ConfigCache._cachedConfigs.clear(); // avoid a memory leak
      }

      const configFile: TSDocConfigFile = TSDocConfigFile.loadFile(configFilePath);

      if (configFile.fileNotFound) {
        Debug.log(`File not found: "${configFilePath}"`);
      } else {
        Debug.log(`Loaded: "${configFilePath}"`);
      }

      cachedConfig = {
        configFile,
        lastCheckTimeMs: nowMs,
        loadTimeMs: nowMs
      };

      ConfigCache._cachedConfigs.set(cacheKey, cachedConfig);
    }

    return cachedConfig.configFile;
  }
}
