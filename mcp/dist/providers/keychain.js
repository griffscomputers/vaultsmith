"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeychainProvider = void 0;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const SERVICE = "vaultsmith";
class KeychainProvider {
    platform;
    constructor() {
        this.platform = process.platform;
        if (this.platform !== "darwin" && this.platform !== "linux") {
            throw new Error(`Unsupported platform: ${this.platform}. Vaultsmith supports macOS and Linux only.`);
        }
    }
    async list(prefix) {
        if (this.platform === "darwin") {
            return this.listMacOS(prefix);
        }
        return this.listLinux(prefix);
    }
    async listMacOS(prefix) {
        try {
            const { stdout } = await execFileAsync("security", ["dump-keychain"]);
            const secrets = [];
            const entries = stdout.split("keychain:");
            for (const entry of entries) {
                const serviceMatch = entry.match(/"svce"<blob>="([^"]*)"/);
                const accountMatch = entry.match(/"acct"<blob>="([^"]*)"/);
                if (serviceMatch && serviceMatch[1] === SERVICE && accountMatch) {
                    const name = accountMatch[1];
                    if (!prefix || name.startsWith(prefix)) {
                        secrets.push({ name });
                    }
                }
            }
            return secrets;
        }
        catch (err) {
            const error = err;
            if (error.code === 44) {
                // No keychain items found
                return [];
            }
            throw new Error(`Failed to list keychain entries: ${error.message}`);
        }
    }
    async listLinux(prefix) {
        try {
            const { stdout } = await execFileAsync("secret-tool", [
                "search",
                "--all",
                "service",
                SERVICE,
            ]);
            const secrets = [];
            const entries = stdout.split("[/org/");
            for (const entry of entries) {
                const accountMatch = entry.match(/attribute\.account\s*=\s*(.+)/);
                if (accountMatch) {
                    const name = accountMatch[1].trim();
                    if (!prefix || name.startsWith(prefix)) {
                        secrets.push({ name });
                    }
                }
            }
            return secrets;
        }
        catch (err) {
            const error = err;
            throw new Error(`Failed to list secrets: ${error.message}`);
        }
    }
    async getRef(name) {
        return `vsm://${name}`;
    }
    async set(name, value, _tags) {
        if (this.platform === "darwin") {
            await this.setMacOS(name, value);
        }
        else {
            await this.setLinux(name, value);
        }
    }
    async setMacOS(name, value) {
        try {
            await execFileAsync("security", [
                "add-generic-password",
                "-U",
                "-s",
                SERVICE,
                "-a",
                name,
                "-w",
                value,
            ]);
        }
        catch (err) {
            const error = err;
            throw new Error(`Failed to store secret "${name}": ${error.message}`);
        }
    }
    async setLinux(name, value) {
        try {
            const child = (0, node_child_process_1.execFile)("secret-tool", [
                "store",
                "--label",
                name,
                "service",
                SERVICE,
                "account",
                name,
            ]);
            if (child.stdin) {
                child.stdin.write(value);
                child.stdin.end();
            }
            await new Promise((resolve, reject) => {
                child.on("close", (code) => {
                    if (code === 0)
                        resolve();
                    else
                        reject(new Error(`secret-tool store exited with code ${code}`));
                });
                child.on("error", reject);
            });
        }
        catch (err) {
            const error = err;
            throw new Error(`Failed to store secret "${name}": ${error.message}`);
        }
    }
    async resolve(ref) {
        const name = ref.replace(/^vsm:\/\//, "");
        if (!name) {
            throw new Error(`Invalid vsm:// reference: ${ref}`);
        }
        if (this.platform === "darwin") {
            return this.resolveMacOS(name);
        }
        return this.resolveLinux(name);
    }
    async resolveMacOS(name) {
        try {
            const { stdout } = await execFileAsync("security", [
                "find-generic-password",
                "-s",
                SERVICE,
                "-a",
                name,
                "-w",
            ]);
            return stdout.trim();
        }
        catch (err) {
            const error = err;
            throw new Error(`Secret "${name}" not found: ${error.message}`);
        }
    }
    async resolveLinux(name) {
        try {
            const { stdout } = await execFileAsync("secret-tool", [
                "lookup",
                "service",
                SERVICE,
                "account",
                name,
            ]);
            return stdout.trim();
        }
        catch (err) {
            const error = err;
            throw new Error(`Secret "${name}" not found: ${error.message}`);
        }
    }
    async delete(name) {
        if (this.platform === "darwin") {
            await this.deleteMacOS(name);
        }
        else {
            await this.deleteLinux(name);
        }
    }
    async deleteMacOS(name) {
        try {
            await execFileAsync("security", [
                "delete-generic-password",
                "-s",
                SERVICE,
                "-a",
                name,
            ]);
        }
        catch (err) {
            const error = err;
            throw new Error(`Failed to delete secret "${name}": ${error.message}`);
        }
    }
    async deleteLinux(name) {
        try {
            await execFileAsync("secret-tool", [
                "clear",
                "service",
                SERVICE,
                "account",
                name,
            ]);
        }
        catch (err) {
            const error = err;
            throw new Error(`Failed to delete secret "${name}": ${error.message}`);
        }
    }
}
exports.KeychainProvider = KeychainProvider;
