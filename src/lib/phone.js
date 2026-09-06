/* Whatsapp Scrapper by abdumezar — phone parsing (isolated world + node tests).
 * Depends on the vendored libphonenumber-js max bundle (global `libphonenumber`).
 */
(function (root) {
  'use strict';
  const lpn = root.libphonenumber || (typeof require === 'function' ? require('./libphonenumber-max.js') : null);
  const displayNames = {};

  function countryName(iso2, locale) {
    if (!iso2) return '';
    const loc = locale || 'en';
    try {
      if (!displayNames[loc]) displayNames[loc] = new Intl.DisplayNames([loc], { type: 'region' });
      return displayNames[loc].of(iso2) || '';
    } catch (e) { return ''; }
  }

  /**
   * @param {string} digits  E.164 digits without '+', e.g. "201001234567"
   * @returns {{country_code:string, country_iso:string, country_name:string, phone_number:string, formatted_phone:string, valid:boolean}}
   */
  function parsePhone(digits, locale) {
    const out = { country_code: '', country_iso: '', country_name: '', phone_number: '', formatted_phone: '', valid: false };
    const d = String(digits || '').replace(/\D/g, '');
    if (!d) return out;
    out.phone_number = d;
    let pn = null;
    try { pn = lpn.parsePhoneNumberFromString('+' + d); } catch (e) { pn = null; }
    if (!pn) {
      // Unparseable: still give the calling code if libphonenumber can split it.
      out.formatted_phone = '+' + d;
      return out;
    }
    out.country_code = pn.countryCallingCode || '';
    out.country_iso = pn.country || '';
    out.country_name = countryName(out.country_iso, locale);
    out.formatted_phone = pn.formatInternational() || ('+' + d);
    out.valid = typeof pn.isValid === 'function' ? pn.isValid() : true;
    return out;
  }

  const api = { parsePhone, countryName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WAXPhone = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
