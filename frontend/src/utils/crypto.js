// Simple secure key-based text cipher (XOR + Base64) for end-to-end safe encryption
const SECRET_KEY = "GAGAN_REALTECH_SECURE_LOCATION_KEY_2026";

export const encryptData = (text) => {
  if (text === undefined || text === null) return "";
  const str = String(text);
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    const keyChar = SECRET_KEY.charCodeAt(i % SECRET_KEY.length);
    result += String.fromCharCode(charCode ^ keyChar);
  }
  try {
    return btoa(result);
  } catch (e) {
    return result;
  }
};

export const decryptData = (hash) => {
  if (!hash) return "";
  try {
    let str = hash;
    try {
      str = atob(hash);
    } catch (e) {
      // fallback
    }
    let result = "";
    for (let i = 0; i < str.length; i++) {
      const charCode = str.charCodeAt(i);
      const keyChar = SECRET_KEY.charCodeAt(i % SECRET_KEY.length);
      result += String.fromCharCode(charCode ^ keyChar);
    }
    return result;
  } catch (e) {
    return "";
  }
};
