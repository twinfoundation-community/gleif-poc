/**
 * Quick sanity check for the local KERIA stack -- tests connectivity
 * and optionally creates a test AID.
 *
 * Usage: npx ts-node test-keria.ts
 *
 * Env vars (all have defaults):
 *   KERIA_ADMIN_URL, KERIA_BOOT_URL, WITNESS_HOST_URL,
 *   WITNESS_INTERNAL_URL, WITNESS_AID, SKIP_WITNESS,
 *   DID_WEBS_RESOLVER_URL
 *
 * Note: KERIA resolves OOBIs from inside its container, so it uses
 * container hostnames (gar-witnesses), not localhost.
 */

import {
    ready,
    SignifyClient,
    Tier,
    randomPasscode,
    Operation,
} from 'signify-ts';

// env or defaults
const KERIA_ADMIN_URL = process.env.KERIA_ADMIN_URL || 'http://localhost:3901';
const KERIA_BOOT_URL = process.env.KERIA_BOOT_URL || 'http://localhost:3903';
// host-side URL -- what this script can actually reach
const WITNESS_HOST_URL = process.env.WITNESS_HOST_URL || 'http://localhost:5642';
// container-side URL -- what KERIA sees
const WITNESS_INTERNAL_URL = process.env.WITNESS_INTERNAL_URL || 'http://gar-witnesses:5642';
const WITNESS_AID = process.env.WITNESS_AID || 'BBilc4-L3tFUnfM_wJr4S4OJanAv_VmF_dJNN6vkf2Ha';
// uses internal hostname since KERIA is the one resolving it
const WITNESS_OOBI = `${WITNESS_INTERNAL_URL}/oobi/${WITNESS_AID}/controller`;
const SKIP_WITNESS = process.env.SKIP_WITNESS === 'true';
const DID_WEBS_RESOLVER_URL = process.env.DID_WEBS_RESOLVER_URL || 'http://localhost:7677';
const TEST_AID_NAME = 'test-aid';

function log(step: string, message: string) {
    console.log(`[${step}] ${message}`);
}

function logError(step: string, message: string) {
    console.error(`[${step}] ERROR: ${message}`);
}

function logWarn(step: string, message: string) {
    console.warn(`[${step}] WARN: ${message}`);
}

async function waitOperation<T>(
    client: SignifyClient,
    op: Operation<T>,
    timeoutMs: number = 60000
): Promise<Operation<T>> {
    const result = await client
        .operations()
        .wait(op, { signal: AbortSignal.timeout(timeoutMs) });

    // clean up after ourselves
    if (result.metadata?.depends) {
        await client.operations().delete(result.metadata.depends.name);
    }
    await client.operations().delete(result.name);

    return result;
}

async function checkHttpEndpoint(url: string, name: string): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        log('HTTP', `${name} (${url}): reachable (status ${response.status})`);
        return true;
    } catch (err) {
        logError('HTTP', `${name} (${url}): not reachable - ${err}`);
        return false;
    }
}

async function main() {
    console.log('='.repeat(60));
    console.log('KERIA Infrastructure Validation');
    console.log('='.repeat(60));
    console.log();
    console.log('Configuration:');
    console.log(`  KERIA API:       ${KERIA_ADMIN_URL}`);
    console.log(`  KERIA Boot:      ${KERIA_BOOT_URL}`);
    console.log(`  Witness (host):  ${WITNESS_HOST_URL}`);
    console.log(`  Witness (KERIA): ${WITNESS_INTERNAL_URL}`);
    console.log(`  Witness AID:     ${WITNESS_AID}`);
    console.log(`  did-webs-resolver: ${DID_WEBS_RESOLVER_URL}`);
    console.log();

    // step 1: check HTTP connectivity
    log('CHECK', 'Verifying HTTP connectivity...');
    const keriaOk = await checkHttpEndpoint(KERIA_ADMIN_URL, 'KERIA API');
    const bootOk = await checkHttpEndpoint(KERIA_BOOT_URL, 'KERIA Boot');
    // witness check from host side (localhost port mapping)
    const witnessHostOobi = `${WITNESS_HOST_URL}/oobi/${WITNESS_AID}/controller`;
    const witnessOk = await checkHttpEndpoint(witnessHostOobi, 'Witness OOBI (host)');
    // did-webs-resolver
    const resolverOk = await checkHttpEndpoint(DID_WEBS_RESOLVER_URL, 'did-webs-resolver');

    if (!keriaOk || !bootOk) {
        logError('CHECK', 'KERIA endpoints not reachable. Is KERIA running?');
        process.exit(1);
    }

    if (!witnessOk && !SKIP_WITNESS) {
        logWarn('CHECK', 'Witness not reachable. Set SKIP_WITNESS=true to skip witness tests.');
    }

    console.log();

    // step 2: init signify-ts
    log('INIT', 'Initializing signify-ts...');
    try {
        await ready();
        log('INIT', 'signify-ts initialized successfully');
    } catch (err) {
        logError('INIT', `Failed to initialize signify-ts: ${err}`);
        process.exit(1);
    }

    // step 3: create client
    log('CLIENT', 'Creating SignifyClient...');
    const bran = randomPasscode().padEnd(21, '_');
    const client = new SignifyClient(KERIA_ADMIN_URL, bran, Tier.low, KERIA_BOOT_URL);

    // step 4: boot + connect
    log('CONNECT', 'Booting and connecting agent...');
    try {
        try {
            await client.connect();
            log('CONNECT', 'Agent already exists, connected successfully');
        } catch {
            log('CONNECT', 'Agent does not exist, booting...');
            const bootRes = await client.boot();
            if (!bootRes.ok) {
                throw new Error(`Boot failed with status ${bootRes.status}`);
            }
            await client.connect();
            log('CONNECT', 'Agent booted and connected successfully');
        }
        log('CONNECT', `Agent AID: ${client.agent?.pre}`);
        log('CONNECT', `Controller AID: ${client.controller.pre}`);
    } catch (err) {
        logError('CONNECT', `Failed to connect: ${err}`);
        process.exit(1);
    }

    // step 5: resolve witness OOBI (if available and not skipped)
    if (SKIP_WITNESS) {
        logWarn('OOBI', 'Skipping witness OOBI resolution (SKIP_WITNESS=true)');
    } else if (!witnessOk) {
        logWarn('OOBI', 'Skipping witness OOBI resolution (witness not reachable)');
    } else {
        log('OOBI', `Resolving witness OOBI: ${WITNESS_OOBI}...`);
        try {
            const oobiOp = await client.oobis().resolve(WITNESS_OOBI, 'witness');
            await waitOperation(client, oobiOp, 60000);
            log('OOBI', 'Witness OOBI resolved successfully');

            // step 6: create a test AID with witness
            log('AID', `Creating test AID "${TEST_AID_NAME}" with witness...`);
            try {
                const existing = await client.identifiers().get(TEST_AID_NAME);
                log('AID', `AID already exists: ${existing.prefix}`);
            } catch {
                const createResult = await client.identifiers().create(TEST_AID_NAME, {
                    toad: 1,
                    wits: [WITNESS_AID],
                });
                await waitOperation(client, await createResult.op(), 60000);

                const roleOp = await client
                    .identifiers()
                    .addEndRole(TEST_AID_NAME, 'agent', client.agent!.pre);
                await waitOperation(client, await roleOp.op());

                const aid = await client.identifiers().get(TEST_AID_NAME);
                log('AID', `AID created successfully: ${aid.prefix}`);
            }
        } catch (err) {
            logError('OOBI', `Failed to resolve witness OOBI: ${err}`);
            logWarn('OOBI', 'This may be a networking issue if KERIA is in a container');
            logWarn('OOBI', 'and cannot resolve the witness hostname advertised in the OOBI.');
            logWarn('OOBI', 'Ensure KERIA can reach the witness at the advertised URL.');
        }
    }

    // Summary
    console.log();
    console.log('='.repeat(60));
    console.log('VALIDATION COMPLETE');
    console.log('='.repeat(60));
    console.log();
    console.log('Results:');
    console.log(`  [OK] KERIA API reachable at ${KERIA_ADMIN_URL}`);
    console.log(`  [OK] KERIA Boot reachable at ${KERIA_BOOT_URL}`);
    console.log(`  [OK] Agent boot/connect successful`);
    if (witnessOk) {
        console.log(`  [OK] Witness reachable at ${WITNESS_HOST_URL}`);
    }
    if (!SKIP_WITNESS) {
        console.log(`  [--] Witness OOBI resolution via ${WITNESS_INTERNAL_URL}`);
    } else {
        console.log(`  [--] Witness validation skipped`);
    }
    if (resolverOk) {
        console.log(`  [OK] did-webs-resolver reachable at ${DID_WEBS_RESOLVER_URL}`);
    } else {
        console.log(`  [--] did-webs-resolver not reachable at ${DID_WEBS_RESOLVER_URL}`);
    }
    console.log();
}

main().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
