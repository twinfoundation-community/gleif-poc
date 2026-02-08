module vlei_attestation::attestation {
    use std::string::String;
    use iota::display;
    use iota::package;

    /// One-time witness
    public struct ATTESTATION has drop {}

    /// vLEI Linkage Attestation
    public struct VleiAttestation has key, store {
        id: UID,
        // Linkage
        did_webs: String,
        did_iota: String,
        // Entity
        lei: String,
        le_aid: String,
        le_credential_said: String,
        // Trust chain
        gleif_aid: String,
        qvi_aid: String,
        qvi_credential_said: String,
        // Attestation
        verified_at: u64,
        verified_by: String,
        // Signed VC (independently verifiable JWT)
        signed_vc: String,
        vc_issuer: String,
        vc_verification_method: String,
    }

    fun init(otw: ATTESTATION, ctx: &mut TxContext) {
        let publisher = package::claim(otw, ctx);

        let mut d = display::new<VleiAttestation>(&publisher, ctx);
        display::add(&mut d, b"name".to_string(), b"vLEI Linkage: {lei}".to_string());
        display::add(&mut d, b"description".to_string(), b"Verified vLEI linkage for LEI {lei} between {did_webs} and {did_iota}".to_string());
        display::add(&mut d, b"creator".to_string(), b"TWIN".to_string());
        display::update_version(&mut d);

        transfer::public_transfer(publisher, ctx.sender());
        transfer::public_transfer(d, ctx.sender());
    }

    public entry fun mint(
        did_webs: String,
        did_iota: String,
        lei: String,
        le_aid: String,
        le_credential_said: String,
        gleif_aid: String,
        qvi_aid: String,
        qvi_credential_said: String,
        verified_at: u64,
        verified_by: String,
        signed_vc: String,
        vc_issuer: String,
        vc_verification_method: String,
        ctx: &mut TxContext,
    ) {
        let att = VleiAttestation {
            id: object::new(ctx),
            did_webs, did_iota, lei,
            le_aid, le_credential_said,
            gleif_aid, qvi_aid, qvi_credential_said,
            verified_at, verified_by,
            signed_vc, vc_issuer, vc_verification_method,
        };
        transfer::public_transfer(att, ctx.sender());
    }
}
