/** KERI key state from KERIA */
export interface KeriKeyState {
  /** Current signing keys */
  k: string[];
  /** Next key digests */
  n: string[];
  /** Backer thresholds */
  bt: string;
  /** Backers */
  b: string[];
  /** Configuration */
  c: string[];
  /** Establishment event digest */
  d: string;
  /** Identifier */
  i: string;
  /** Sequence number */
  s: string;
  /** Type */
  t: string;
}

/** KERI credential from KERIA */
export interface KeriCredential {
  sad: {
    /** Credential SAID */
    d: string;
    /** Schema SAID */
    s: string;
    /** Attributes */
    a: {
      /** Issuee AID */
      i: string;
      /** LEI (for LE credentials) */
      LEI?: string;
      [key: string]: unknown;
    };
  };
  /** Anchor event */
  anc: Record<string, unknown>;
  /** Issuance event */
  iss: Record<string, unknown>;
}

/** KERI operation result from signify-ts */
export interface KeriOperation {
  name: string;
  done: boolean;
  metadata?: {
    depends?: {
      name: string;
    };
  };
}
