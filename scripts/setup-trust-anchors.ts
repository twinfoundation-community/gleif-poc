/**
 * Sets up a simulated GLEIF trust chain for the vLEI PoC.
 *
 * Spins up GLEIF root, QVI, and LE AIDs; issues the credential chain
 * between them; then configures Sally so she can verify LE creds.
 *
 * Usage: npx ts-node setup-trust-anchors.ts
 *
 * Env vars (all have sane defaults):
 *   KERIA_ADMIN_URL, KERIA_BOOT_URL, WITNESS_INTERNAL_URL,
 *   WITNESS_AID, SALLY_INTERNAL_URL, SALLY_AID
 */

import {
    ready,
    SignifyClient,
    Tier,
    randomPasscode,
    Operation,
    Serder,
    CredentialData,
    CredentialSubject,
} from 'signify-ts';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// env or defaults
const KERIA_ADMIN_URL = process.env.KERIA_ADMIN_URL || 'http://localhost:3901';
const KERIA_BOOT_URL = process.env.KERIA_BOOT_URL || 'http://localhost:3903';
const WITNESS_INTERNAL_URL = process.env.WITNESS_INTERNAL_URL || 'http://gar-witnesses:5642';
const WITNESS_AID = process.env.WITNESS_AID || 'BBilc4-L3tFUnfM_wJr4S4OJanAv_VmF_dJNN6vkf2Ha';
const WITNESS_OOBI = `${WITNESS_INTERNAL_URL}/oobi/${WITNESS_AID}/controller`;

// sally (direct mode)
const SALLY_INTERNAL_URL = process.env.SALLY_INTERNAL_URL || 'http://direct-sally:9823';
const SALLY_AID = process.env.SALLY_AID || 'ECLwKe5b33BaV20x7HZWYi_KUXgY91S41fRL2uCaf4WQ';
const SALLY_OOBI = `${SALLY_INTERNAL_URL}/oobi/${SALLY_AID}/controller`;
const SALLY_KS_NAME = process.env.DIRECT_SALLY_KS_NAME || 'direct-sally';
const SALLY_PASSCODE = process.env.DIRECT_SALLY_PASSCODE || '4TBjjhmKu9oeDp49J7Xdy';

// backend for IOTA DID creation
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

// vLEI server -- container hostname so KERIA can reach it
const VLEI_SERVER_URL = process.env.VLEI_SERVER_URL || 'http://vlei-server:7723';

// schema SAIDs from vLEI spec
const QVI_SCHEMA_SAID = 'EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao';
const LE_SCHEMA_SAID = 'ENPXp1vQzRF6JwIuS-mp2U8Uf1MoADoP_GqQ62VsDZWY';
const DESIGNATED_ALIASES_SCHEMA_SAID = 'EN6Oh5XSD5_q2Hgu-aqpdfbVepdpYpFlgz6zvJL5b_r5';

// schema OOBI URLs
const QVI_SCHEMA_OOBI = `${VLEI_SERVER_URL}/oobi/${QVI_SCHEMA_SAID}`;
const LE_SCHEMA_OOBI = `${VLEI_SERVER_URL}/oobi/${LE_SCHEMA_SAID}`;
const DESIGNATED_ALIASES_SCHEMA_OOBI = `${VLEI_SERVER_URL}/oobi/${DESIGNATED_ALIASES_SCHEMA_SAID}`;

// output file
const CONFIG_FILE = path.join(__dirname, '.trust-anchors.json');

// AID + registry names
const GLEIF_AID_NAME = 'gleif';
const QVI_AID_NAME = 'qvi';
const LE_AID_NAME = 'legal-entity';
const GLEIF_REGISTRY_NAME = 'gleif-registry';
const QVI_REGISTRY_NAME = 'qvi-registry';
const LE_REGISTRY_NAME = 'le-registry';

interface TrustAnchorConfig {
    gleif: {
        name: string;
        aid: string;
        passcode: string;
        oobi: string;
        registryId: string;
    };
    qvi: {
        name: string;
        aid: string;
        passcode: string;
        oobi: string;
        registryId: string;
    };
    le: {
        name: string;
        aid: string;
        passcode: string;
        oobi: string;
        lei: string;
        registryId?: string;
        iotaDid?: string;
    };
    qviCredential: {
        said: string;
        schema: string;
        issuer: string;
        issuee: string;
    };
    leCredential: {
        said: string;
        schema: string;
        issuer: string;
        issuee: string;
    };
    designatedAliasesCredential?: {
        said: string;
        schema: string;
        issuer: string;
        ids: string[];
    };
    sally: {
        aid: string;
        configured: boolean;
        gleifOobiResolved: boolean;
        qviCredentialPreloaded: boolean;
    };
    timestamp: string;
}

// detect docker vs podman -- same logic as local-stack/start.sh
async function getContainerRuntime(): Promise<{ docker: string; containerName: string }> {
    // Container name is the same for both docker-compose and podman-compose
    const containerName = 'keria_docker_direct-sally_1';

    // Try docker first
    try {
        await execAsync('docker --version');
        return { docker: 'docker', containerName };
    } catch {
        // Docker not available, try podman
    }

    // Try podman
    try {
        await execAsync('podman --version');
        return { docker: 'podman', containerName };
    } catch {
        // Podman not available
    }

    throw new Error('Neither docker nor podman found');
}

async function execInSallyContainer(
    docker: string,
    containerName: string,
    command: string
): Promise<{ stdout: string; stderr: string }> {
    const fullCommand = `${docker} exec ${containerName} ${command}`;
    log('EXEC', `Running: ${fullCommand}`);
    return execAsync(fullCommand, { timeout: 60000 });
}

function log(step: string, message: string, isError: boolean = false) {
    const prefix = isError ? `[${step}] ERROR: ` : `[${step}] `;
    if (isError) {
        console.error(prefix + message);
    } else {
        console.log(prefix + message);
    }
}

function createTimestamp(): string {
    return new Date().toISOString().replace('Z', '000+00:00');
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

async function getOrCreateClient(
    bran: string,
    clientName: string
): Promise<SignifyClient> {
    const paddedBran = bran.padEnd(21, '_');
    const client = new SignifyClient(KERIA_ADMIN_URL, paddedBran, Tier.low, KERIA_BOOT_URL);

    try {
        await client.connect();
        log(clientName, 'Connected to existing agent');
    } catch {
        log(clientName, 'Booting new agent...');
        const bootRes = await client.boot();
        if (!bootRes.ok) {
            throw new Error(`Boot failed with status ${bootRes.status}`);
        }
        await client.connect();
        log(clientName, 'Agent booted and connected');
    }

    return client;
}

async function resolveOobi(
    client: SignifyClient,
    oobi: string,
    alias: string
): Promise<void> {
    log('OOBI', `Resolving ${alias}: ${oobi}`);
    const op = await client.oobis().resolve(oobi, alias);
    await waitOperation(client, op, 60000);
    log('OOBI', `Resolved ${alias} successfully`);
}

async function getOrCreateAid(
    client: SignifyClient,
    name: string,
    witnessAid: string
): Promise<{ prefix: string; oobi: string }> {
    try {
        const existing = await client.identifiers().get(name);
        log('AID', `${name} already exists: ${existing.prefix}`);

        const oobiResult = await client.oobis().get(name, 'agent');
        const oobi = oobiResult.oobis[0];

        return { prefix: existing.prefix, oobi };
    } catch {
        log('AID', `Creating ${name} with witness support...`);

        const createResult = await client.identifiers().create(name, {
            toad: 1,
            wits: [witnessAid],
        });
        await waitOperation(client, await createResult.op(), 60000);

        // add agent end role
        const roleOp = await client
            .identifiers()
            .addEndRole(name, 'agent', client.agent!.pre);
        await waitOperation(client, await roleOp.op());

        const aid = await client.identifiers().get(name);
        log('AID', `${name} created: ${aid.prefix}`);

        const oobiResult = await client.oobis().get(name, 'agent');
        const oobi = oobiResult.oobis[0];

        return { prefix: aid.prefix, oobi };
    }
}

async function getOrCreateRegistry(
    client: SignifyClient,
    aidName: string,
    registryName: string
): Promise<string> {
    // check if it already exists
    const registries = await client.registries().list(aidName);
    const existing = registries.find((r: any) => r.name === registryName);

    if (existing) {
        log('REGISTRY', `${registryName} already exists: ${existing.regk}`);
        return existing.regk;
    }

    log('REGISTRY', `Creating ${registryName}...`);
    const regResult = await client.registries().create({
        name: aidName,
        registryName: registryName,
    });
    await waitOperation(client, await regResult.op(), 60000);

    // fetch it back to get the ID
    const newRegistries = await client.registries().list(aidName);
    const newRegistry = newRegistries.find((r: any) => r.name === registryName);

    if (!newRegistry) {
        throw new Error(`Failed to create registry ${registryName}`);
    }

    log('REGISTRY', `${registryName} created: ${newRegistry.regk}`);
    return newRegistry.regk;
}

async function getIssuedCredential(
    client: SignifyClient,
    issuerPrefix: string,
    recipientPrefix: string,
    schemaSaid: string
): Promise<any | null> {
    const credentials = await client.credentials().list({
        filter: {
            '-i': issuerPrefix,
            '-s': schemaSaid,
            '-a-i': recipientPrefix,
        },
    });
    return credentials.length > 0 ? credentials[0] : null;
}

async function issueQviCredential(
    gleifClient: SignifyClient,
    gleifAidName: string,
    gleifPrefix: string,
    registryId: string,
    qviPrefix: string
): Promise<{ said: string; credential: any }> {
    // already issued?
    const existing = await getIssuedCredential(
        gleifClient,
        gleifPrefix,
        qviPrefix,
        QVI_SCHEMA_SAID
    );

    if (existing) {
        log('CREDENTIAL', `QVI credential already exists: ${existing.sad.d}`);
        return { said: existing.sad.d, credential: existing };
    }

    log('CREDENTIAL', 'Issuing QVI credential from GLEIF to QVI...');

    // simplified for PoC -- production would include proper LEI validation
    const qviData: CredentialSubject = {
        i: qviPrefix,  // issuee
        dt: createTimestamp(),
        LEI: '254900OPPU84GM83MG36',  // Example LEI for demo QVI organization
    };

    const credData: CredentialData = {
        i: gleifPrefix,  // issuer
        ri: registryId,
        s: QVI_SCHEMA_SAID,
        a: qviData,
    };

    const credResult = await gleifClient.credentials().issue(gleifAidName, credData);
    await waitOperation(gleifClient, credResult.op, 60000);

    // fetch it back
    const credential = await getIssuedCredential(
        gleifClient,
        gleifPrefix,
        qviPrefix,
        QVI_SCHEMA_SAID
    );

    if (!credential) {
        throw new Error('Failed to issue QVI credential');
    }

    log('CREDENTIAL', `QVI credential issued: ${credential.sad.d}`);
    return { said: credential.sad.d, credential };
}

async function grantCredential(
    client: SignifyClient,
    senderAidName: string,
    credential: any,
    recipientPrefix: string,
    description: string
): Promise<void> {
    log('IPEX', `Granting ${description} credential via IPEX...`);

    const [grant, gsigs, gend] = await client.ipex().grant({
        senderName: senderAidName,
        acdc: new Serder(credential.sad),
        anc: new Serder(credential.anc),
        iss: new Serder(credential.iss),
        recipient: recipientPrefix,
        datetime: createTimestamp(),
    });

    const op = await client
        .ipex()
        .submitGrant(senderAidName, grant, gsigs, gend, [recipientPrefix]);
    await waitOperation(client, op);

    log('IPEX', `${description} credential granted successfully`);
}

async function admitCredential(
    client: SignifyClient,
    aidName: string,
    issuerPrefix: string,
    schemaSaid: string,
    entityName: string,
    expectedCredSaid?: string,
    maxRetries: number = 10
): Promise<void> {
    log('IPEX', `${entityName} waiting for grant notification...`);

    // grant notification might take a moment to arrive
    let grantNote: any = null;
    for (let retry = 0; retry < maxRetries; retry++) {
        const notifications = await client.notifications().list();
        grantNote = notifications.notes.find(
            (n: any) => n.a.r === '/exn/ipex/grant' && !n.r
        );

        if (grantNote) {
            break;
        }

        log('IPEX', `No grant notification yet, waiting... (${retry + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!grantNote) {
        log('IPEX', 'No pending grant notification found - credential may already be admitted');

        // see if the entity already has it
        const credentials = await client.credentials().list({
            filter: { '-s': schemaSaid }
        });

        if (credentials.length > 0) {
            log('IPEX', `${entityName} already has ${credentials.length} credential(s)`);
        } else {
            log('IPEX', `Warning: ${entityName} does not appear to have the credential`);
        }
        return;
    }

    log('IPEX', `Found grant notification: ${grantNote.a.d}`);

    const [admit, asigs, aend] = await client.ipex().admit({
        senderName: aidName,
        message: '',
        grantSaid: grantNote.a.d,
        recipient: issuerPrefix,
        datetime: createTimestamp(),
    });

    const op = await client
        .ipex()
        .submitAdmit(aidName, admit, asigs, aend, [issuerPrefix]);
    await waitOperation(client, op);

    // mark as read
    await client.notifications().mark(grantNote.i);

    // if we know the expected SAID, wait until the credential shows up
    if (expectedCredSaid) {
        log('IPEX', `Waiting for credential ${expectedCredSaid} to be available...`);
        for (let i = 0; i < maxRetries; i++) {
            const creds = await client.credentials().list({
                filter: { '-d': expectedCredSaid },
            });
            if (creds.length > 0) {
                log('IPEX', `${entityName} credential admitted successfully: ${creds[0].sad.d}`);
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
            log('IPEX', `Credential not yet available, waiting... (${i + 1}/${maxRetries})`);
        }

        // last-ditch check
        const finalCreds = await client.credentials().list();
        log('IPEX', `Final credential count: ${finalCreds.length}`);
        log('IPEX', `Warning: ${entityName} credential may not have been admitted properly`);
    } else {
        log('IPEX', `${entityName} credential admitted successfully`);
    }
}

async function issueLeCredential(
    qviClient: SignifyClient,
    qviAidName: string,
    qviPrefix: string,
    registryId: string,
    lePrefix: string,
    qviCredSaid: string,
    leLei: string
): Promise<{ said: string; credential: any }> {
    // already issued?
    const existing = await getIssuedCredential(
        qviClient,
        qviPrefix,
        lePrefix,
        LE_SCHEMA_SAID
    );

    if (existing) {
        log('CREDENTIAL', `LE credential already exists: ${existing.sad.d}`);
        return { said: existing.sad.d, credential: existing };
    }

    log('CREDENTIAL', 'Issuing LE credential from QVI to Legal Entity...');

    // LE credential per vLEI spec
    const leData: CredentialSubject = {
        i: lePrefix,  // issuee
        dt: createTimestamp(),
        LEI: leLei,
    };

    const credData: CredentialData = {
        i: qviPrefix,  // issuer
        ri: registryId,
        s: LE_SCHEMA_SAID,
        a: leData,
        e: {
            // edge to QVI cred -- proves QVI is authorized to issue
            d: '',  // SAID computed by signify-ts
            qvi: {
                n: qviCredSaid,
                s: QVI_SCHEMA_SAID,
            },
        },
        r: {
            // rules -- must match schema exactly (from vLEI spec)
            d: '',
            usageDisclaimer: {
                l: 'Usage of a valid, unexpired, and non-revoked vLEI Credential, as defined in the associated Ecosystem Governance Framework, does not assert that the Legal Entity is trustworthy, honest, reputable in its business dealings, safe to do business with, or compliant with any laws or that an implied or expressly intended purpose will be fulfilled.',
            },
            issuanceDisclaimer: {
                l: 'All information in a valid, unexpired, and non-revoked vLEI Credential, as defined in the associated Ecosystem Governance Framework, is accurate as of the date the validation process was complete. The vLEI Credential has been issued to the legal entity or person named in the vLEI Credential as the subject; and the qualified vLEI Issuer exercised reasonable care to perform the validation process set forth in the vLEI Ecosystem Governance Framework.',
            },
        },
    };

    const credResult = await qviClient.credentials().issue(qviAidName, credData);
    await waitOperation(qviClient, credResult.op, 60000);

    // fetch it back
    const credential = await getIssuedCredential(
        qviClient,
        qviPrefix,
        lePrefix,
        LE_SCHEMA_SAID
    );

    if (!credential) {
        throw new Error('Failed to issue LE credential');
    }

    log('CREDENTIAL', `LE credential issued: ${credential.sad.d}`);
    return { said: credential.sad.d, credential };
}



/**
 * Adds the alsoKnownAs reverse link (did:iota -> did:webs) for Direction 2.
 */
async function addAlsoKnownAsViaBackend(
    iotaDid: string,
    didWebs: string
): Promise<boolean> {
    log('IOTA', `Adding alsoKnownAs reverse link to ${iotaDid}`);
    log('IOTA', `  did:webs: ${didWebs}`);

    try {
        const response = await fetch(`${BACKEND_URL}/api/iota/add-also-known-as`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                documentId: iotaDid,
                aliases: [didWebs],
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            log('IOTA', `Backend returned error: ${response.status} - ${errorText}`);
            return false;
        }

        const result = await response.json() as { success?: boolean };
        if (result.success) {
            log('IOTA', `Reverse link added successfully`);
            return true;
        }

        log('IOTA', 'Backend response indicates failure');
        return false;
    } catch (err: any) {
        log('IOTA', `Failed to add reverse link: ${err.message || err}`);
        return false;
    }
}

/**
 * Creates an IOTA DID via the backend. Backend needs to be running, obviously.
 */
async function createIotaDidViaBackend(): Promise<{ did: string; document: any } | null> {
    log('IOTA', `Attempting to create IOTA DID via ${BACKEND_URL}/api/iota/create-did`);

    try {
        const response = await fetch(`${BACKEND_URL}/api/iota/create-did`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        if (!response.ok) {
            const errorText = await response.text();
            log('IOTA', `Backend returned error: ${response.status} - ${errorText}`);
            return null;
        }

        const result = await response.json() as { did?: string; document?: any };

        if (!result.did) {
            log('IOTA', 'Backend response missing "did" field');
            return null;
        }

        log('IOTA', `Created IOTA DID: ${result.did}`);
        return { did: result.did, document: result.document };
    } catch (err: any) {
        log('IOTA', `Failed to create IOTA DID via backend: ${err.message || err}`);
        return null;
    }
}


/**
 * Self-issued by the LE -- declares which DIDs are aliases for the same entity.
 * Basically the glue between did:webs and did:iota.
 */
async function issueDesignatedAliasesCredential(
    leClient: SignifyClient,
    leAidName: string,
    lePrefix: string,
    registryId: string,
    linkedIds: string[]
): Promise<{ said: string; credential: any }> {
    // already issued?
    const existing = await getIssuedCredential(
        leClient,
        lePrefix,
        lePrefix,  // Self-issued: issuer and issuee are the same
        DESIGNATED_ALIASES_SCHEMA_SAID
    );

    if (existing) {
        log('CREDENTIAL', `Designated Aliases credential already exists: ${existing.sad.d}`);
        return { said: existing.sad.d, credential: existing };
    }

    log('CREDENTIAL', 'Issuing Designated Aliases credential (self-signed by LE)...');

    // 'ids' holds the alias DIDs; attributes block is just dt + ids
    const aliasData = {
        dt: createTimestamp(),
        ids: linkedIds,  // Array of linked DIDs (e.g., did:iota:...)
    };

    const credData: CredentialData = {
        i: lePrefix,  // issuer (self-issued)
        ri: registryId,
        s: DESIGNATED_ALIASES_SCHEMA_SAID,
        a: aliasData,
        r: {
            // rules -- must match schema exactly
            d: '',  // SAID computed by signify-ts
            aliasDesignation: {
                l: 'The issuer of this ACDC designates the identifiers in the ids field as the only allowed namespaced aliases of the issuer\'s AID.',
            },
            usageDisclaimer: {
                l: 'This attestation only asserts designated aliases of the controller of the AID, that the AID controlled namespaced alias has been designated by the controller. It does not assert that the controller of this AID has control over the infrastructure or anything else related to the namespace other than the included AID.',
            },
            issuanceDisclaimer: {
                l: 'All information in a valid and non-revoked alias designation assertion is accurate as of the date specified.',
            },
            termsOfUse: {
                l: 'Designated aliases of the AID must only be used in a manner consistent with the expressed intent of the AID controller.',
            },
        },
    };

    const credResult = await leClient.credentials().issue(leAidName, credData);
    await waitOperation(leClient, credResult.op, 60000);

    // credential needs a moment to get indexed
    await new Promise(resolve => setTimeout(resolve, 2000));

    // fetch it back -- querying all and filtering manually because the API filter is broken
    const allCredentials = await leClient.credentials().list();
    const credentials = allCredentials.filter(
        (c: any) => c.sad.s === DESIGNATED_ALIASES_SCHEMA_SAID && c.sad.i === lePrefix
    );

    const credential = credentials.length > 0 ? credentials[0] : null;

    if (!credential) {
        throw new Error('Failed to issue Designated Aliases credential');
    }

    log('CREDENTIAL', `Designated Aliases credential issued: ${credential.sad.d}`);
    log('CREDENTIAL', `  Linked IDs: ${linkedIds.join(', ')}`);
    return { said: credential.sad.d, credential };
}

async function main() {
    console.log('='.repeat(60));
    console.log('Trust Anchor Setup - vLEI PoC');
    console.log('='.repeat(60));
    console.log();
    console.log('Configuration:');
    console.log(`  KERIA API:       ${KERIA_ADMIN_URL}`);
    console.log(`  KERIA Boot:      ${KERIA_BOOT_URL}`);
    console.log(`  Witness (KERIA): ${WITNESS_INTERNAL_URL}`);
    console.log(`  Witness AID:     ${WITNESS_AID}`);
    console.log(`  Sally (KERIA):   ${SALLY_INTERNAL_URL}`);
    console.log(`  Sally AID:       ${SALLY_AID}`);
    console.log(`  vLEI Server:     ${VLEI_SERVER_URL}`);
    console.log(`  QVI Schema:      ${QVI_SCHEMA_SAID}`);
    console.log();

    // init signify-ts
    log('INIT', 'Initializing signify-ts...');
    await ready();
    log('INIT', 'signify-ts ready');

    // separate passcodes per entity
    const gleifPasscode = randomPasscode();
    const qviPasscode = randomPasscode();
    const lePasscode = randomPasscode();

    // example LEI from GLEIF test data
    const leLei = '5493001KJTIIGC8Y1R12';

    log('PASSCODE', `GLEIF passcode generated (first 4 chars): ${gleifPasscode.substring(0, 4)}...`);
    log('PASSCODE', `QVI passcode generated (first 4 chars): ${qviPasscode.substring(0, 4)}...`);
    log('PASSCODE', `LE passcode generated (first 4 chars): ${lePasscode.substring(0, 4)}...`);

    // step 1: GLEIF client + witness OOBI
    console.log();
    log('STEP 1', 'Setting up GLEIF Root AID...');

    const gleifClient = await getOrCreateClient(gleifPasscode, 'GLEIF');
    await resolveOobi(gleifClient, WITNESS_OOBI, 'witness');

    const gleifAid = await getOrCreateAid(gleifClient, GLEIF_AID_NAME, WITNESS_AID);
    log('GLEIF', `AID: ${gleifAid.prefix}`);
    log('GLEIF', `OOBI: ${gleifAid.oobi}`);

    // step 2: QVI client + witness OOBI
    console.log();
    log('STEP 2', 'Setting up QVI AID...');

    const qviClient = await getOrCreateClient(qviPasscode, 'QVI');
    await resolveOobi(qviClient, WITNESS_OOBI, 'witness');

    const qviAid = await getOrCreateAid(qviClient, QVI_AID_NAME, WITNESS_AID);
    log('QVI', `AID: ${qviAid.prefix}`);
    log('QVI', `OOBI: ${qviAid.oobi}`);

    // step 3: GLEIF <-> QVI OOBI exchange
    console.log();
    log('STEP 3', 'Resolving OOBIs between GLEIF and QVI...');

    await resolveOobi(gleifClient, qviAid.oobi, 'qvi');
    await resolveOobi(qviClient, gleifAid.oobi, 'gleif');

    log('OOBI', 'GLEIF and QVI now know each other');

    // step 4: schema OOBIs -- must resolve these before issuing anything
    console.log();
    log('STEP 4', 'Resolving credential schema OOBIs...');

    // GLEIF needs schemas to issue
    await resolveOobi(gleifClient, QVI_SCHEMA_OOBI, 'qvi-schema');
    await resolveOobi(gleifClient, LE_SCHEMA_OOBI, 'le-schema');

    // QVI needs them too for LE credential issuance later
    await resolveOobi(qviClient, QVI_SCHEMA_OOBI, 'qvi-schema');
    await resolveOobi(qviClient, LE_SCHEMA_OOBI, 'le-schema');

    log('SCHEMA', 'Schema OOBIs resolved for both GLEIF and QVI');

    // step 5: GLEIF registry
    console.log();
    log('STEP 5', 'Creating GLEIF credential registry...');

    const gleifRegistryId = await getOrCreateRegistry(
        gleifClient,
        GLEIF_AID_NAME,
        GLEIF_REGISTRY_NAME
    );

    // step 6: QVI credential (GLEIF -> QVI)
    console.log();
    log('STEP 6', 'Issuing QVI credential...');

    const { said: qviCredSaid, credential: qviCredential } = await issueQviCredential(
        gleifClient,
        GLEIF_AID_NAME,
        gleifAid.prefix,
        gleifRegistryId,
        qviAid.prefix
    );

    // step 7: grant to QVI via IPEX
    console.log();
    log('STEP 7', 'Granting credential to QVI via IPEX...');

    await grantCredential(
        gleifClient,
        GLEIF_AID_NAME,
        qviCredential,
        qviAid.prefix,
        'QVI'
    );

    // step 8: QVI admits it
    console.log();
    log('STEP 8', 'QVI admitting credential...');

    await admitCredential(qviClient, QVI_AID_NAME, gleifAid.prefix, QVI_SCHEMA_SAID, 'QVI');

    // step 9: LE client + AID
    console.log();
    log('STEP 9', 'Setting up Legal Entity (LE) AID...');

    const leClient = await getOrCreateClient(lePasscode, 'LE');
    await resolveOobi(leClient, WITNESS_OOBI, 'witness');

    const leAid = await getOrCreateAid(leClient, LE_AID_NAME, WITNESS_AID);
    log('LE', `AID: ${leAid.prefix}`);
    log('LE', `OOBI: ${leAid.oobi}`);

    // step 10: QVI <-> LE OOBI exchange
    console.log();
    log('STEP 10', 'Resolving OOBIs between QVI and LE...');

    await resolveOobi(qviClient, leAid.oobi, 'legal-entity');
    await resolveOobi(leClient, qviAid.oobi, 'qvi');
    // LE also needs GLEIF's OOBI for chain verification
    await resolveOobi(leClient, gleifAid.oobi, 'gleif');
    // LE needs ALL schemas in the chain -- the LE cred edges to QVI, so both are required
    await resolveOobi(leClient, QVI_SCHEMA_OOBI, 'qvi-schema');
    await resolveOobi(leClient, LE_SCHEMA_OOBI, 'le-schema');

    log('OOBI', 'QVI and LE now know each other');

    // step 11: QVI registry for LE cred issuance
    console.log();
    log('STEP 11', 'Creating QVI credential registry...');

    const qviRegistryId = await getOrCreateRegistry(
        qviClient,
        QVI_AID_NAME,
        QVI_REGISTRY_NAME
    );

    // step 12: LE credential (QVI -> LE)
    console.log();
    log('STEP 12', 'Issuing LE credential...');

    const { said: leCredSaid, credential: leCredential } = await issueLeCredential(
        qviClient,
        QVI_AID_NAME,
        qviAid.prefix,
        qviRegistryId,
        leAid.prefix,
        qviCredSaid,
        leLei
    );

    // step 13: grant LE cred via IPEX
    console.log();
    log('STEP 13', 'Granting LE credential to Legal Entity via IPEX...');

    await grantCredential(
        qviClient,
        QVI_AID_NAME,
        leCredential,
        leAid.prefix,
        'LE'
    );

    // step 14: LE admits it
    console.log();
    log('STEP 14', 'Legal Entity admitting credential...');

    await admitCredential(leClient, LE_AID_NAME, qviAid.prefix, LE_SCHEMA_SAID, 'LE', leCredSaid);

    // step 14a: designated aliases schema OOBI
    console.log();
    log('STEP 14a', 'Resolving Designated Aliases schema OOBI...');

    await resolveOobi(leClient, DESIGNATED_ALIASES_SCHEMA_OOBI, 'designated-aliases-schema');
    log('SCHEMA', 'Designated Aliases schema OOBI resolved');

    // step 14b: LE registry for self-issued creds
    console.log();
    log('STEP 14b', 'Creating LE credential registry...');

    const leRegistryId = await getOrCreateRegistry(
        leClient,
        LE_AID_NAME,
        LE_REGISTRY_NAME
    );

    // step 14c: designated aliases credential
    console.log();
    log('STEP 14c', 'Issuing Designated Aliases credential...');

    // try backend first for a real IOTA DID
    let linkedIotaDid: string;
    let iotaDidCreatedViaBackend = false;

    // try: backend API -> env var -> placeholder
    const backendResult = await createIotaDidViaBackend();
    if (backendResult) {
        linkedIotaDid = backendResult.did;
        iotaDidCreatedViaBackend = true;
        log('CREDENTIAL', `Using IOTA DID from backend: ${linkedIotaDid}`);

        // reverse link (did:iota -> did:webs) for Direction 2
        // format must match config.ts: did:webs:backend:keri:{aid}
        const didWebs = `did:webs:backend:keri:${leAid.prefix}`;
        const reverseLinked = await addAlsoKnownAsViaBackend(linkedIotaDid, didWebs);
        if (reverseLinked) {
            log('CREDENTIAL', `Reverse link established: ${linkedIotaDid} -> ${didWebs}`);
        } else {
            log('CREDENTIAL', 'Warning: Could not establish reverse link for Direction 2');
        }
    } else if (process.env.LE_IOTA_DID) {
        linkedIotaDid = process.env.LE_IOTA_DID;
        log('CREDENTIAL', `Backend unavailable, using LE_IOTA_DID env: ${linkedIotaDid}`);
    } else {
        throw new Error('Cannot create Designated Aliases credential: no IOTA DID available. Run with backend (./start.sh --with-backend) or set LE_IOTA_DID env var.');
    }

    const linkedIds = [linkedIotaDid];

    let designatedAliasesCredSaid: string | undefined;

    try {
        const result = await issueDesignatedAliasesCredential(
            leClient,
            LE_AID_NAME,
            leAid.prefix,
            leRegistryId,
            linkedIds
        );
        designatedAliasesCredSaid = result.said;
        log('CREDENTIAL', `Designated Aliases credential issued: ${designatedAliasesCredSaid}`);
    } catch (err: any) {
        log('CREDENTIAL', `Warning: Could not issue Designated Aliases credential: ${err.message || err}`);
        log('CREDENTIAL', 'This is optional for PoC - continuing without it');
    }

    // step 15: GLEIF resolves Sally OOBI
    console.log();
    log('STEP 15', 'GLEIF resolving Sally OOBI...');

    let sallyConfigured = false;
    try {
        // GLEIF needs to know Sally
        await resolveOobi(gleifClient, SALLY_OOBI, 'sally');
        log('SALLY', 'Sally OOBI resolved by GLEIF');
        sallyConfigured = true;
    } catch (err) {
        log('SALLY', `Warning: Could not resolve Sally OOBI: ${err}`);
        log('SALLY', 'Sally may not be running or accessible from KERIA');
    }

    // step 16: configure Sally with GLEIF trust anchor (OOBI resolve inside Sally's container)
    console.log();
    log('STEP 16', 'Configuring Sally with GLEIF trust anchor...');

    let sallyGleifOobiResolved = false;
    try {
        const { docker, containerName } = await getContainerRuntime();
        log('SALLY', `Using container runtime: ${docker}, container: ${containerName}`);

        // Sally needs GLEIF's OOBI to trust it as root of the cred chain
        const kliCommand = `kli oobi resolve --name ${SALLY_KS_NAME} --passcode ${SALLY_PASSCODE} --oobi "${gleifAid.oobi}"`;
        const { stdout, stderr } = await execInSallyContainer(docker, containerName, kliCommand);

        if (stderr && !stderr.includes('already resolved')) {
            log('SALLY', `kli stderr: ${stderr}`);
        }
        if (stdout) {
            log('SALLY', `kli stdout: ${stdout}`);
        }

        log('SALLY', 'Sally now trusts GLEIF as root of trust');
        sallyGleifOobiResolved = true;
    } catch (err: any) {
        log('SALLY', `Warning: Could not configure Sally trust anchor: ${err.message || err}`);
        log('SALLY', 'Manual configuration required:');
        log('SALLY', `  docker exec keria_docker_direct-sally_1 kli oobi resolve --name ${SALLY_KS_NAME} --passcode ${SALLY_PASSCODE} --oobi "${gleifAid.oobi}"`);
    }

    // step 17: pre-load QVI credential into Sally so she can walk the chain
    console.log();
    log('STEP 17', 'Presenting QVI credential to Sally (chain pre-loading)...');

    let sallyQviCredPreloaded = false;
    if (sallyConfigured) {
        try {
            // Sally needs the QVI cred before she can verify LE creds (chain: LE -> QVI -> GLEIF)
            await grantCredential(
                gleifClient,
                GLEIF_AID_NAME,
                qviCredential,
                SALLY_AID,
                'QVI to Sally (chain pre-loading)'
            );
            log('SALLY', 'QVI credential pre-loaded into Sally');
            log('SALLY', 'Sally can now verify LE credentials (chain: LE -> QVI -> GLEIF)');
            sallyQviCredPreloaded = true;
        } catch (err: any) {
            log('SALLY', `Warning: Could not present QVI credential to Sally: ${err.message || err}`);
            log('SALLY', 'Sally may need manual credential presentation for chain verification');
        }
    } else {
        log('SALLY', 'Skipping QVI credential presentation - Sally OOBI not resolved');
        log('SALLY', 'Manual presentation will be required after Sally is accessible');
    }

    // step 18: save config
    console.log();
    log('STEP 18', 'Saving configuration...');

    const config: TrustAnchorConfig = {
        gleif: {
            name: GLEIF_AID_NAME,
            aid: gleifAid.prefix,
            passcode: gleifPasscode,
            oobi: gleifAid.oobi,
            registryId: gleifRegistryId,
        },
        qvi: {
            name: QVI_AID_NAME,
            aid: qviAid.prefix,
            passcode: qviPasscode,
            oobi: qviAid.oobi,
            registryId: qviRegistryId,
        },
        le: {
            name: LE_AID_NAME,
            aid: leAid.prefix,
            passcode: lePasscode,
            oobi: leAid.oobi,
            lei: leLei,
            registryId: leRegistryId,
            iotaDid: linkedIotaDid,
        },
        qviCredential: {
            said: qviCredSaid,
            schema: QVI_SCHEMA_SAID,
            issuer: gleifAid.prefix,
            issuee: qviAid.prefix,
        },
        leCredential: {
            said: leCredSaid,
            schema: LE_SCHEMA_SAID,
            issuer: qviAid.prefix,
            issuee: leAid.prefix,
        },
        designatedAliasesCredential: designatedAliasesCredSaid ? {
            said: designatedAliasesCredSaid,
            schema: DESIGNATED_ALIASES_SCHEMA_SAID,
            issuer: leAid.prefix,
            ids: linkedIds,
        } : undefined,
        sally: {
            aid: SALLY_AID,
            configured: sallyConfigured,
            gleifOobiResolved: sallyGleifOobiResolved,
            qviCredentialPreloaded: sallyQviCredPreloaded,
        },
        timestamp: new Date().toISOString(),
    };

    await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
    log('CONFIG', `Configuration saved to ${CONFIG_FILE}`);

    // Summary
    console.log();
    console.log('='.repeat(60));
    console.log('TRUST ANCHOR SETUP COMPLETE');
    console.log('='.repeat(60));
    console.log();
    console.log('Environment variables for .env:');
    console.log();
    console.log(`GLEIF_ROOT_AID=${gleifAid.prefix}`);
    console.log(`GLEIF_ROOT_OOBI=${gleifAid.oobi}`);
    console.log(`QVI_AID=${qviAid.prefix}`);
    console.log(`QVI_OOBI=${qviAid.oobi}`);
    console.log(`QVI_CREDENTIAL_SAID=${qviCredSaid}`);
    console.log(`LE_AID=${leAid.prefix}`);
    console.log(`LE_OOBI=${leAid.oobi}`);
    console.log(`LE_CREDENTIAL_SAID=${leCredSaid}`);
    console.log(`LE_LEI=${leLei}`);
    console.log();
    console.log('Trust Chain:');
    console.log(`  GLEIF (Root) --> QVI Credential --> QVI --> LE Credential --> Legal Entity`);
    console.log();
    console.log(`  GLEIF AID:   ${gleifAid.prefix}`);
    console.log(`  QVI AID:     ${qviAid.prefix}`);
    console.log(`  LE AID:      ${leAid.prefix}`);
    console.log(`  QVI Cred:    ${qviCredSaid}`);
    console.log(`  LE Cred:     ${leCredSaid}`);
    console.log(`  LE LEI:      ${leLei}`);
    if (designatedAliasesCredSaid) {
        console.log(`  DA Cred:     ${designatedAliasesCredSaid} (Designated Aliases)`);
        console.log(`  Linked IDs:  ${linkedIds.join(', ')}`);
        if (iotaDidCreatedViaBackend) {
            console.log(`  IOTA DID:    Created via backend API`);
        } else if (linkedIotaDid.includes('0'.repeat(40))) {
            console.log(`  IOTA DID:    PLACEHOLDER - run with --with-backend for real DID`);
        }
    }
    console.log();
    console.log('Sally Configuration:');
    console.log(`  ${sallyConfigured ? '[OK]' : '[!]'} GLEIF resolved Sally OOBI`);
    console.log(`  ${sallyGleifOobiResolved ? '[OK]' : '[!]'} Sally configured with GLEIF trust anchor`);
    console.log(`  ${sallyQviCredPreloaded ? '[OK]' : '[!]'} QVI credential pre-loaded into Sally`);
    if (sallyConfigured && sallyGleifOobiResolved && sallyQviCredPreloaded) {
        console.log('  Sally is ready to verify LE credentials');
    } else {
        console.log('  Manual configuration may be required:');
        if (!sallyConfigured) {
            console.log('    - Ensure Sally is running and accessible from KERIA');
        }
        if (!sallyGleifOobiResolved) {
            console.log(`    - docker exec keria_docker_direct-sally_1 kli oobi resolve --name ${SALLY_KS_NAME} --passcode ${SALLY_PASSCODE} --oobi "${gleifAid.oobi}"`);
        }
        if (!sallyQviCredPreloaded) {
            console.log('    - Present QVI credential to Sally (via IPEX grant from GLEIF to Sally)');
        }
    }
    console.log();
    console.log('Next Steps:');
    console.log('  1. Test verification flow with Sally');
    console.log('  2. Present LE credentials to Sally for verification');
    console.log();
}

main().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
