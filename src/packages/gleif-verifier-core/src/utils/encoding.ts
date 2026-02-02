/** decode base64url string to Uint8Array */
export function base64urlToBytes(str: string): Uint8Array {
  // Add padding if needed
  let padded = str;
  while (padded.length % 4 !== 0) {
    padded += '=';
  }

  // Convert base64url to standard base64
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');

  // Decode to bytes
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** encode Uint8Array to base64url string (no padding) */
export function bytesToBase64url(bytes: Uint8Array): string {
  // Convert to binary string
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  // Encode to base64
  const base64 = btoa(binary);

  // Convert to base64url (no padding)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
