import fs from 'fs/promises';
import path from 'path';
import { CacheOptions, Opts, getCacheMap, getMountArgsString, getTargetPath } from './opts.js';
import { run, runPiped } from './run.js';

async function extractCache(cacheSource: string, cacheOptions: CacheOptions, scratchDir: string) {
    // Prepare Timestamp for Layer Cache Busting
    const date = new Date().toISOString();
    await fs.writeFile(path.join(scratchDir, 'buildstamp'), date);

    // Prepare Dancefile to Access Caches
    const targetPath = getTargetPath(cacheOptions);
    const mountArgs = getMountArgsString(cacheOptions);

    const dancefileContent = `
FROM busybox:1
COPY buildstamp buildstamp
RUN --mount=${mountArgs} \
    mkdir -p /var/dance-cache/ \
    && cp -p -R ${targetPath}/. /var/dance-cache/ || true
`;
    await fs.writeFile(path.join(scratchDir, 'Dancefile.extract'), dancefileContent);
    console.log(dancefileContent);

    // Extract Data into Docker Image
    await run('docker', ['buildx', 'build', '-f', path.join(scratchDir, 'Dancefile.extract'), '--tag', 'dance:extract', '--load', scratchDir]);

    // Create Extraction Image
    const containerName = 'cache-container-' + Math.random().toString(10).substring(2,8);
    try {
        await run('docker', ['rm', '-f', containerName]);
    } catch (error) {
        // Ignore error if container does not exist
    }
    await run('docker', ['create', '-ti', '--name', containerName, 'dance:extract']);

    // Unpack Docker Image into Scratch
    await runPiped(
        ['docker', ['cp', '-L', containerName + ':/var/dance-cache', '-']],
        ['tar', ['-H', 'posix', '-x', '-C', scratchDir]]
    );

    // Move Cache into Its Place
    await fs.rm(cacheSource, { recursive: true, force: true });
    await fs.rename(path.join(scratchDir, 'dance-cache'), cacheSource);
}

export async function extractCaches(opts: Opts) {
    if (opts["skip-extraction"]) {
        console.log("skip-extraction is set. Skipping extraction step...");
        return;
    }

    const cacheMap = getCacheMap(opts);
    const scratchDir = opts['scratch-dir'];

    // Extract Caches for each source-target pair
    for (const [cacheSource, cacheOptions] of Object.entries(cacheMap)) {
        await extractCache(cacheSource, cacheOptions, scratchDir);
    }
}
