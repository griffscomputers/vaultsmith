import { VaultProvider, SecretMetadata } from "./interface.js";
export declare class KeychainProvider implements VaultProvider {
    private platform;
    constructor();
    list(prefix?: string): Promise<SecretMetadata[]>;
    private listMacOS;
    private listLinux;
    getRef(name: string): Promise<string>;
    set(name: string, value: string, _tags?: Record<string, string>): Promise<void>;
    private setMacOS;
    private setLinux;
    resolve(ref: string): Promise<string>;
    private resolveMacOS;
    private resolveLinux;
    delete(name: string): Promise<void>;
    private deleteMacOS;
    private deleteLinux;
}
