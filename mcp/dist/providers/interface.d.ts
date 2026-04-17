export interface SecretMetadata {
    name: string;
    tags?: Record<string, string>;
    createdAt?: string;
    updatedAt?: string;
}
export interface VaultProvider {
    /** List secret names matching an optional prefix */
    list(prefix?: string): Promise<SecretMetadata[]>;
    /** Get the vsm:// reference URI for a secret by name */
    getRef(name: string): Promise<string>;
    /** Store a secret value */
    set(name: string, value: string, tags?: Record<string, string>): Promise<void>;
    /** Resolve a vsm:// reference to its plaintext value */
    resolve(ref: string): Promise<string>;
    /** Delete a secret by name */
    delete(name: string): Promise<void>;
}
