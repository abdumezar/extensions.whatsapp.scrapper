/* Whatsapp Scrapper by abdumezar — every DOM selector the fallback path uses, in one place.
 * Verified against WhatsApp Web 2.3000.1046916940 on 6 Sep 2026.
 * WhatsApp's class names are hashed and rotate; data-testid and role attributes
 * have been stable for years, so everything below leans on those. */
const WAX_SELECTORS = {
  main: '#main',
  headerButton: '#main header [data-testid="conversation-info-header"], #main header [role="button"][title="Profile details"]',
  drawer: '[data-testid="chat-info-drawer"]',
  drawerCloseButton: '[data-testid="chat-info-drawer"] [role="button"][aria-label="Close"], [data-testid="chat-info-drawer"] [aria-label="Close"]',
  participantsSection: '[data-testid="group-info-participants-section"]',
  viewAllPattern: /view all|see all|show all|عرض الكل/i,
  memberCountPattern: /(\d[\d,.]*)\s*(members|participants|عضو|أعضاء|مشارك)/i,
  contactsModal: '[data-testid="contacts-modal"]',
  modalCloseButton: '[data-testid="contacts-modal"] [aria-label="Close"], [data-testid="contacts-modal"] [title="Close"]',
  listItem: '[role="listitem"]',
  cellTitle: '[data-testid="cell-frame-title"]',
  cellSecondary: '[data-testid="cell-frame-secondary"]',
  cellDetail: '[data-testid="cell-frame-primary-detail"]',
  adminMarker: '[data-testid="group-admin-marker"]',
  adminPattern: /admin|مشرف/i,
  numberPattern: /^\+?[\d\s\-().]{6,}$/,
};
