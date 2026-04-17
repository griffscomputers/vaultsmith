import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { VaultProvider, SecretMetadata } from "./interface.js";

const execFileAsync = promisify(execFile);

const SERVICE = "vaultsmith";

export class KeychainProvider implements VaultProvider {
  private platform: NodeJS.Platform;

  constructor() {
    this.platform = process.platform;
    if (this.platform !== "darwin" && this.platform !== "linux") {
      throw new Error(
        `Unsupported platform: ${this.platform}. Vaultsmith supports macOS and Linux only.`
      );
    }
  }

  async list(prefix?: string): Promise<SecretMetadata[]> {
    if (this.platform === "darwin") {
      return this.listMacOS(prefix);
    }
    return this.listLinux(prefix);
  }

  private async listMacOS(prefix?: string): Promise<SecretMetadata[]> {
    try {
      const { stdout } = await execFileAsync("security", ["dump-keychain"]);
      const secrets: SecretMetadata[] = [];
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
    } catch (err) {
      const error = err as Error & { code?: number };
      if (error.code === 44) {
        // No keychain items found
        return [];
      }
      throw new Error(`Failed to list keychain entries: ${error.message}`);
    }
  }

  private async listLinux(prefix?: string): Promise<SecretMetadata[]> {
    try {
      const { stdout } = await execFileAsync("secret-tool", [
        "search",
        "--all",
        "service",
        SERVICE,
      ]);
      const secrets: SecretMetadata[] = [];
      const entries = stdout.split("[/org/");

      for (const entry of entries) {
        const accountMatch = entry.match(
          /attribute\.account\s*=\s*(.+)/
        );
        if (accountMatch) {
          const name = accountMatch[1].trim();
          if (!prefix || name.startsWith(prefix)) {
            secrets.push({ name });
          }
        }
      }

      return secrets;
    } catch (err) {
      const error = err as Error;
      throw new Error(`Failed to list secrets: ${error.message}`);
    }
  }

  async getRef(name: string): Promise<string> {
    return `vsm://${name}`;
  }

  async set(
    name: string,
    value: string,
    _tags?: Record<string, string>
  ): Promise<void> {
    if (this.platform === "darwin") {
      await this.setMacOS(name, value);
    } else {
      await this.setLinux(name, value);
    }
  }

  private async setMacOS(name: string, value: string): Promise<void> {
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
    } catch (err) {
      const error = err as Error;
      throw new Error(`Failed to store secret "${name}": ${error.message}`);
    }
  }

  private async setLinux(name: string, value: string): Promise<void> {
    try {
      const child = execFile("secret-tool", [
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
      await new Promise<void>((resolve, reject) => {
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`secret-tool store exited with code ${code}`));
        });
        child.on("error", reject);
      });
    } catch (err) {
      const error = err as Error;
      throw new Error(`Failed to store secret "${name}": ${error.message}`);
    }
  }

  async resolve(ref: string): Promise<string> {
    const name = ref.replace(/^vsm:\/\//, "");
    if (!name) {
      throw new Error(`Invalid vsm:// reference: ${ref}`);
    }

    if (this.platform === "darwin") {
      return this.resolveMacOS(name);
    }
    return this.resolveLinux(name);
  }

  private async resolveMacOS(name: string): Promise<string> {
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
    } catch (err) {
      const error = err as Error;
      throw new Error(`Secret "${name}" not found: ${error.message}`);
    }
  }

  private async resolveLinux(name: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync("secret-tool", [
        "lookup",
        "service",
        SERVICE,
        "account",
        name,
      ]);
      return stdout.trim();
    } catch (err) {
      const error = err as Error;
      throw new Error(`Secret "${name}" not found: ${error.message}`);
    }
  }

  async delete(name: string): Promise<void> {
    if (this.platform === "darwin") {
      await this.deleteMacOS(name);
    } else {
      await this.deleteLinux(name);
    }
  }

  private async deleteMacOS(name: string): Promise<void> {
    try {
      await execFileAsync("security", [
        "delete-generic-password",
        "-s",
        SERVICE,
        "-a",
        name,
      ]);
    } catch (err) {
      const error = err as Error;
      throw new Error(`Failed to delete secret "${name}": ${error.message}`);
    }
  }

  private async deleteLinux(name: string): Promise<void> {
    try {
      await execFileAsync("secret-tool", [
        "clear",
        "service",
        SERVICE,
        "account",
        name,
      ]);
    } catch (err) {
      const error = err as Error;
      throw new Error(`Failed to delete secret "${name}": ${error.message}`);
    }
  }
}
