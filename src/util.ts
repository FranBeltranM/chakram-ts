import { createHmac } from "crypto";
import randomUuid from "uuid/v4";

/**
 * Generate a 'unique' client/device id for requests
 */
export function generateDeviceId(
    userAgent: string,
    uuid: string = randomUuid(),
) {
    const hmac = createHmac("sha224", userAgent);
    hmac.update(uuid);
    return hmac.digest("hex");
}
