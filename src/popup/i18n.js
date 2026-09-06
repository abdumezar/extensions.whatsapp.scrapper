/*
 * Whatsapp Scrapper by abdumezar — popup strings (English / Arabic).
 *
 * Same shape as the theme controller: the choice is a preference in
 * localStorage (`wax:lang`), read synchronously by theme-preload.js so <html>
 * carries the right lang and dir before the first paint — an RTL flip after
 * paint is far uglier than a colour flash.
 *
 * Markup carries `data-i18n` (text), `data-i18n-title` and `data-i18n-ph`
 * (placeholder) so no string is built by concatenation in popup.js except the
 * counted lines, which take parameters.
 *
 * Warnings arriving from the content script are codes, not sentences, for the
 * same reason — see WARN below.
 */
const WAXI18n = (() => {
  'use strict';

  const KEY = 'wax:lang';
  const LANGS = ['en', 'ar'];

  const EN = {
    appName: 'Whatsapp Scrapper',
    byline: 'by abdumezar',
    checking: 'Checking…',
    notWhatsapp: 'Not WhatsApp',
    notConnected: 'Not connected',
    screenReading: 'Screen-reading mode',
    storeOk: 'Store OK',
    blockNotWhatsapp: 'This tab is not WhatsApp Web.',
    blockOpen: 'Open WhatsApp Web',
    blockNotInjected: 'The extension is not running in this tab yet. Reload the WhatsApp tab and try again.',
    blockReload: 'Reload the tab',
    openChat: 'Open chat',
    kindGroup: 'Group',
    kindSubgroup: 'Community group',
    kindCommunity: 'Community',
    kindBroadcast: 'Broadcast list',
    nMembers: (n) => n.toLocaleString() + ' members',
    privacyIds: 'privacy-mode ids',
    noChatOpen: 'No chat open',
    noChatOpenHint: 'Open a group, community or broadcast list in WhatsApp.',
    tabThisChat: 'This chat',
    tabPickChats: 'Pick chats',
    filterGroups: 'Filter groups…',
    selectAll: 'Select all',
    selectNone: 'None',
    nothingSelected: 'Nothing selected',
    nSelected: (n) => n + (n === 1 ? ' chat selected' : ' chats selected'),
    pickSomeChats: 'Pick one or more chats above.',
    options: 'Options',
    format: 'Format',
    formatCsv: 'CSV',
    formatXlsx: 'Excel (.xlsx)',
    formatVcf: 'Contacts (.vcf)',
    communities: 'Communities',
    communityAnnounce: 'Announcement group (all members)',
    communityAll: 'Every sub-group, deduplicated',
    countryNames: 'Country names',
    langEn: 'English',
    langAr: 'العربية',
    includeMe: 'Include my own row',
    onlyRows: 'Only include',
    filterAdmins: 'admins',
    filterSaved: 'saved contacts',
    filterBusiness: 'business',
    filterWithPhone: 'rows with a number',
    filterCountries: 'Country codes',
    filterCountriesHint: 'e.g. 20, 966',
    changesOnly: 'Only people who joined since the last export',
    extraColumns: 'Extra columns',
    forceDom: 'Force screen-reading mode (debug)',
    diagnostics: 'Copy diagnostics',
    resetBaseline: 'Reset the joined/left baseline',
    baselineCleared: 'Baseline cleared',
    preparing: 'Preparing preview…',
    reading: 'Reading participants…',
    readingChat: (done, total, title) => `Reading ${done}/${total} · ${title}`,
    readingScreen: (n) => `Reading from the screen — ${n.toLocaleString()} so far`,
    building: 'Building the file…',
    copying: 'Building the table…',
    cancel: 'Cancel',
    cancelled: 'Cancelled',
    exportCsv: 'Export',
    exportN: (n) => 'Export ' + n.toLocaleString() + ' rows',
    nothingToExport: 'Nothing to export',
    copy: 'Copy',
    copied: (n) => 'Copied ' + n.toLocaleString() + ' rows to the clipboard',
    copyFailed: 'Could not write to the clipboard',
    saved: (name, n) => `Saved ${name} (${n.toLocaleString()} rows)`,
    diagnosticsCopied: 'Diagnostics copied',
    // Reconciliation line
    nChats: (n) => n + ' chats',
    perWhatsapp: (n) => n.toLocaleString() + ' members per WhatsApp',
    nRows: (n) => n.toLocaleString() + ' rows',
    nWithPhone: (n) => n.toLocaleString() + ' with phone',
    nSaved: (n) => n + ' saved',
    nBusiness: (n) => n + ' business',
    nAdmins: (n) => n + ' admins',
    nFiltered: (n) => n.toLocaleString() + ' filtered out',
    diffLine: (joined, left, since) => `+${joined} joined · −${left} left since ${since}`,
    screenReadingPrefix: 'Screen-reading mode',
    untestedBuild: (v) => `Untested WhatsApp build ${v} — if something looks wrong, copy the diagnostics.`,
    theme: 'Theme',
    themeSystem: 'follow system',
    themeLight: 'light',
    themeDark: 'dark',
    language: 'Language',
  };

  /* Arabic-Indic digits, so a counted line never mixes numeral systems. */
  const ar = (n) => Number(n).toLocaleString('ar-EG');

  const AR = {
    appName: 'مستخرج واتساب',
    byline: 'بواسطة abdumezar',
    checking: 'جارٍ الفحص…',
    notWhatsapp: 'ليست واتساب',
    notConnected: 'غير متصل',
    screenReading: 'وضع القراءة من الشاشة',
    storeOk: 'المخزن يعمل',
    blockNotWhatsapp: 'هذه التبويبة ليست واتساب ويب.',
    blockOpen: 'افتح واتساب ويب',
    blockNotInjected: 'الإضافة لا تعمل في هذه التبويبة بعد. أعد تحميل تبويبة واتساب ثم حاول مرة أخرى.',
    blockReload: 'أعد تحميل التبويبة',
    openChat: 'المحادثة المفتوحة',
    kindGroup: 'مجموعة',
    kindSubgroup: 'مجموعة داخل مجتمع',
    kindCommunity: 'مجتمع',
    kindBroadcast: 'قائمة بث',
    nMembers: (n) => ar(n) + ' عضوًا',
    privacyIds: 'معرّفات وضع الخصوصية',
    noChatOpen: 'لا توجد محادثة مفتوحة',
    noChatOpenHint: 'افتح مجموعة أو مجتمعًا أو قائمة بث في واتساب.',
    tabThisChat: 'هذه المحادثة',
    tabPickChats: 'اختيار محادثات',
    filterGroups: 'تصفية المجموعات…',
    selectAll: 'تحديد الكل',
    selectNone: 'إلغاء التحديد',
    nothingSelected: 'لم يتم تحديد شيء',
    nSelected: (n) => (n === 1 ? 'محادثة واحدة محددة' : `${ar(n)} محادثات محددة`),
    pickSomeChats: 'اختر محادثة أو أكثر بالأعلى.',
    options: 'الخيارات',
    format: 'الصيغة',
    formatCsv: 'CSV',
    formatXlsx: 'إكسل (.xlsx)',
    formatVcf: 'جهات اتصال (.vcf)',
    communities: 'المجتمعات',
    communityAnnounce: 'مجموعة الإعلانات (كل الأعضاء)',
    communityAll: 'كل المجموعات الفرعية، بدون تكرار',
    countryNames: 'أسماء الدول',
    langEn: 'English',
    langAr: 'العربية',
    includeMe: 'تضمين صفّي',
    onlyRows: 'اقتصر على',
    filterAdmins: 'المشرفين',
    filterSaved: 'جهات الاتصال المحفوظة',
    filterBusiness: 'حسابات الأعمال',
    filterWithPhone: 'الصفوف التي بها رقم',
    filterCountries: 'رموز الدول',
    filterCountriesHint: 'مثال: 20، 966',
    changesOnly: 'من انضم فقط منذ آخر تصدير',
    extraColumns: 'أعمدة إضافية',
    forceDom: 'فرض القراءة من الشاشة (تشخيص)',
    diagnostics: 'نسخ بيانات التشخيص',
    resetBaseline: 'إعادة ضبط أساس المقارنة',
    baselineCleared: 'تمت إعادة الضبط',
    preparing: 'جارٍ تجهيز المعاينة…',
    reading: 'جارٍ قراءة الأعضاء…',
    readingChat: (done, total, title) => `القراءة ${ar(done)}/${ar(total)} · ${title}`,
    readingScreen: (n) => `القراءة من الشاشة — ${ar(n)} حتى الآن`,
    building: 'جارٍ إنشاء الملف…',
    copying: 'جارٍ تجهيز الجدول…',
    cancel: 'إلغاء',
    cancelled: 'تم الإلغاء',
    exportCsv: 'تصدير',
    exportN: (n) => 'تصدير ' + ar(n) + ' صفًا',
    nothingToExport: 'لا يوجد ما يُصدَّر',
    copy: 'نسخ',
    copied: (n) => 'تم نسخ ' + ar(n) + ' صفًا',
    copyFailed: 'تعذّرت الكتابة إلى الحافظة',
    saved: (name, n) => `تم حفظ ${name} (${ar(n)} صفًا)`,
    diagnosticsCopied: 'تم نسخ بيانات التشخيص',
    nChats: (n) => `${ar(n)} محادثات`,
    perWhatsapp: (n) => ar(n) + ' عضوًا حسب واتساب',
    nRows: (n) => ar(n) + ' صفًا',
    nWithPhone: (n) => ar(n) + ' برقم',
    nSaved: (n) => `${ar(n)} محفوظًا`,
    nBusiness: (n) => `${ar(n)} أعمال`,
    nAdmins: (n) => `${ar(n)} مشرفًا`,
    nFiltered: (n) => ar(n) + ' مستبعدًا',
    diffLine: (joined, left, since) => `+${ar(joined)} انضموا · −${ar(left)} غادروا منذ ${since}`,
    screenReadingPrefix: 'وضع القراءة من الشاشة',
    untestedBuild: (v) => `إصدار واتساب ${v} غير مختبَر — إن بدا شيء غير صحيح فانسخ بيانات التشخيص.`,
    theme: 'المظهر',
    themeSystem: 'حسب النظام',
    themeLight: 'فاتح',
    themeDark: 'داكن',
    language: 'اللغة',
  };

  /* Warnings are raised in the content script, which has no strings — it emits
     a code and its numbers, and they become a sentence only here. */
  const WARN = {
    en: {
      domMode: () => 'Store unavailable — data read from the screen. Numbers are only visible for people not in your contacts; is_business is unknown.',
      domPartial: (w) => `Read ${w.got} of ${w.reported} members — the scroll may have skipped rows; try again with the WhatsApp tab visible.`,
      chatNotFound: (w) => `Chat ${w.id} not found — skipped.`,
      noSubgroups: (w) => `${w.title}: no sub-groups loaded — exporting community admins only.`,
      noAnnouncement: (w) => `${w.title}: announcement group not loaded — exporting community admins only.`,
      chatFailed: (w) => `${w.title}: ${w.message}`,
      vcardNoPhone: (w) => `${w.n} ${w.n === 1 ? 'row has' : 'rows have'} no number and cannot become a contact — skipped.`,
    },
    ar: {
      domMode: () => 'المخزن غير متاح — تمت القراءة من الشاشة. الأرقام تظهر فقط لمن ليسوا في جهات اتصالك، وحالة حساب الأعمال غير معروفة.',
      domPartial: (w) => `تمت قراءة ${w.got} من ${w.reported} عضوًا — قد يكون التمرير تخطّى صفوفًا؛ حاول مرة أخرى وتبويبة واتساب ظاهرة.`,
      chatNotFound: (w) => `لم يتم العثور على المحادثة ${w.id} — تم تخطيها.`,
      noSubgroups: (w) => `${w.title}: لم تُحمَّل المجموعات الفرعية — سيتم تصدير مشرفي المجتمع فقط.`,
      noAnnouncement: (w) => `${w.title}: لم تُحمَّل مجموعة الإعلانات — سيتم تصدير مشرفي المجتمع فقط.`,
      chatFailed: (w) => `${w.title}: ${w.message}`,
      vcardNoPhone: (w) => `${w.n} صفًا بلا رقم ولا يمكن تحويلها إلى جهات اتصال — تم تخطيها.`,
    },
  };

  const DICT = { en: EN, ar: AR };

  function saved() {
    try {
      const v = localStorage.getItem(KEY);
      return LANGS.indexOf(v) !== -1 ? v : 'en';
    } catch (e) { return 'en'; }
  }

  let lang = 'en';

  /** t('key') for plain strings, t('key', a, b) for the counted ones. */
  function t(key, ...args) {
    const v = (DICT[lang] || EN)[key];
    if (typeof v === 'function') return v(...args);
    return v === undefined ? key : v;
  }

  /** Turns one warning object from the content script into a sentence. */
  function warning(w) {
    if (typeof w === 'string') return w;                       // legacy / unexpected
    const table = WARN[lang] || WARN.en;
    const fn = table[w && w.code];
    return fn ? fn(w) : (w && w.message) || String(w && w.code);
  }

  /** Paints every marked node in the document. */
  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const s = t(el.dataset.i18nTitle);
      el.title = s;
      if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', s);
    });
    scope.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  }

  /** Sets the language on <html> too: dir drives the whole RTL layout. */
  function set(next) {
    lang = LANGS.indexOf(next) !== -1 ? next : 'en';
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    apply();
    return lang;
  }

  function init() { return set(saved()); }

  return {
    KEY, LANGS, t, warning, apply, set, init, saved,
    current: () => lang,
    other: () => (lang === 'ar' ? 'en' : 'ar'),
    // Exposed so test/i18n.test.js can hold the two languages to each other.
    dicts: DICT,
    warningTables: WARN,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = WAXI18n;
