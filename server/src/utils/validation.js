import filterXSS from 'xss';

const ABOUT_MAX_LENGTH = 160;
const ABOUT_ALLOWED_CHARS_REGEX = /^[\p{L}\p{M}\p{N}\p{Zs}\n.,!?'@#&:\p{Extended_Pictographic}\u200D\uFE0F-]+$/u;
const ABOUT_HTML_TAG_REGEX = /<\s*\/\s*[a-z][^>]*>|<\s*[a-z][^>]*>/i;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 20;
const USERNAME_ALLOWED_CHARS_REGEX = /^[a-z0-9._]+$/;
const USERNAME_CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF]/;

const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;

// ===================================================
// DISPOSABLE EMAIL DOMAINS LIST (Server-side)
// ===================================================
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com',
  '10minutemail.de',
  '10minutemail.fr',
  '10minutemail.net',
  '10minutemail.org',
  'mailinator.com',
  'maildrop.cc',
  'maildrop.gq',
  'mailnesia.com',
  'mailnesia.net',
  'mailnesia.org',
  'sharklasers.com',
  'spam4.me',
  'spam4me.com',
  'temporaryemail.com',
  'tempmail.com',
  'tempmailaddress.com',
  'throwaway.email',
  'throwawaymail.com',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'yopmail.org',
  'mailme.ir',
  'tempmail.alpha.com',
  'temp-mail.org',
  '0-mail.com',
  'betr0th.com',
  'fakeinbox.com',
  'fakemail.net',
  'freeshoutbox.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'hushmail.com',
  'jetable.org',
  'mytrashmail.com',
  'nada.email',
  'postalicious.com',
  'privatemail.com',
  'putka.cc',
  'temp-mail.io',
  'tempmail.xyz',
  'trashmail.com',
  'trashmail.de',
  'trashmail.ws',
  'u2609.com',
  'walala.com',
  'zzz.com',
  'zbwguy.com',
  'tempemail.co',
  '1secmail.com',
  '1secmail.net',
  '1secmail.org',
  'anonbox.net',
  'temp-mail.ru',
  'kuku.cc',
]);

const DOMAIN_LABEL_REGEX = /^[A-Za-z0-9-]+$/;
const TOP_LEVEL_DOMAIN_REGEX = /^(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})$/;

export const normalizeEmail = (email) => {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase().replace(/\s/g, '');
};

export const normalizeUsername = (username) => {
  if (typeof username !== 'string') return '';

  return username.normalize('NFKC').trim().toLowerCase();
};

export const getUsernameValidationError = (username) => {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername) {
    return 'Invalid username';
  }

  if (normalizedUsername.length < USERNAME_MIN_LENGTH || normalizedUsername.length > USERNAME_MAX_LENGTH) {
    return 'Invalid username';
  }

  if (USERNAME_CONTROL_CHARS_REGEX.test(String(username || ''))) {
    return 'Invalid username';
  }

  if (!USERNAME_ALLOWED_CHARS_REGEX.test(normalizedUsername)) {
    return 'Invalid username';
  }

  if (/^[._]|[._]$/.test(normalizedUsername)) {
    return 'Invalid username';
  }

  if (/\.\./.test(normalizedUsername)) {
    return 'Invalid username';
  }

  return '';
};

export const isDisposableEmailDomain = (email) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail.includes('@')) return false;
  
  const domain = normalizedEmail.split('@')[1].toLowerCase();
  
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    return true;
  }
  
  if (domain.endsWith('.guerrillamail.com') || 
      domain.endsWith('.guerrillamail.net') ||
      domain.endsWith('.guerrillamail.org') ||
      domain.endsWith('.10minutemail.com') ||
      domain.endsWith('.10minutemail.de') ||
      domain.endsWith('.10minutemail.fr') ||
      domain.endsWith('.10minutemail.net') ||
      domain.endsWith('.10minutemail.org') ||
      domain.endsWith('.yopmail.com') ||
      domain.endsWith('.yopmail.fr') ||
      domain.endsWith('.yopmail.net') ||
      domain.endsWith('.yopmail.org') ||
      domain.endsWith('.mailnesia.com') ||
      domain.endsWith('.mailnesia.net') ||
      domain.endsWith('.mailnesia.org') ||
      domain.endsWith('.temp-mail.org')) {
    return true;
  }
  
  return false;
};

export const hasHomographAttack = (email) => {
  const normalizedEmail = normalizeEmail(email);
  const domain = normalizedEmail.split('@')[1] || '';
  
  const suspiciousPatterns = [
    /[0o](?=[a-z]*\.com)/i,
    /rn(?=ail)/i,
    /vvv(?=\.)/,
    /l1(?=ink)/i,
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(domain)) {
      return true;
    }
  }
  
  return false;
};

export const isValidEmailFormat = (email) => {
  const normalizedEmail = normalizeEmail(email);
  
  if (!normalizedEmail) return false;
  if (normalizedEmail.length > MAX_EMAIL_LENGTH) return false;
  if (normalizedEmail.includes(' ')) return false;
  
  const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  return EMAIL_REGEX.test(normalizedEmail);
};

export const getEmailValidationError = (email, skipDisposableCheck = false) => {
  const trimmedEmail = typeof email === 'string' ? email.trim() : '';

  if (!trimmedEmail) return 'Email is required';
  
  if (trimmedEmail.length > MAX_EMAIL_LENGTH) {
    return `Email must be at most ${MAX_EMAIL_LENGTH} characters`;
  }

  if (/\s/.test(trimmedEmail)) {
    return 'Email cannot contain spaces';
  }

  if (!isValidEmailFormat(trimmedEmail)) {
    return 'Please enter a valid email address';
  }

  if (hasHomographAttack(trimmedEmail)) {
    return 'This email domain appears to be spoofed. Please use your actual email address';
  }

  if (!skipDisposableCheck && isDisposableEmailDomain(trimmedEmail)) {
    return 'Temporary or disposable email addresses are not allowed. Please use your permanent email address';
  }

  const [localPart, ...domainParts] = trimmedEmail.split('@');
  const domain = domainParts.join('@');

  if (!localPart || !domain) {
    return 'Please enter a valid email address';
  }

  if (localPart.length > MAX_LOCAL_PART_LENGTH) {
    return `Email local part must be at most ${MAX_LOCAL_PART_LENGTH} characters`;
  }

  if (localPart.startsWith('.') || localPart.endsWith('.')) {
    return 'Email cannot start or end with a period';
  }

  if (localPart.includes('..')) {
    return 'Email cannot contain consecutive periods';
  }

  if (domain.startsWith('-') || domain.endsWith('-')) {
    return 'Email domain is invalid';
  }

  if (!domain.includes('.')) {
    return 'Email domain must contain at least one period';
  }

  const domainLabels = domain.split('.');
  for (const label of domainLabels) {
    if (!label) return 'Email domain is invalid';
    if (!DOMAIN_LABEL_REGEX.test(label)) {
      return 'Email domain contains invalid characters';
    }
  }

  const tld = domainLabels[domainLabels.length - 1];
  if (!TOP_LEVEL_DOMAIN_REGEX.test(tld)) {
    return 'Email domain has an invalid top-level domain';
  }

  return '';
};

export const normalizeAboutText = (aboutText) => {
    if (typeof aboutText !== 'string') return '';

    return aboutText
        .replace(/\u00A0/g, ' ')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
};

export const sanitizeAboutText = (aboutText) => filterXSS(normalizeAboutText(aboutText), {
    whiteList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script'],
});

export const getAboutValidationError = (aboutText, options = {}) => {
    const {
        required = false,
        maxLength = ABOUT_MAX_LENGTH,
    } = options;

    const normalizedAboutText = normalizeAboutText(aboutText);

    if (!normalizedAboutText) {
        return required ? 'About section is required' : '';
    }

    if (normalizedAboutText.length > maxLength) {
        return `About section must be at most ${maxLength} characters`;
    }

    if (ABOUT_HTML_TAG_REGEX.test(normalizedAboutText)) {
        return 'HTML and script tags are not allowed in your bio';
    }

    if (!ABOUT_ALLOWED_CHARS_REGEX.test(normalizedAboutText)) {
        return "About section can only contain letters, numbers, spaces, emojis, line breaks, and basic punctuation (. , ! ? ' - @ # & :)";
    }

    return '';
};
const FULL_NAME_MIN_LENGTH = 2;
const FULL_NAME_MAX_LENGTH = 50;

const FULL_NAME_ALLOWED_CHARS_REGEX = /^[\p{L}\p{M}' -]+$/u;
const FULL_NAME_FORMAT_REGEX = /^[\p{L}\p{M}]+(?:[ '-][\p{L}\p{M}]+)*$/u;

export const normalizeFullName = (fullName) => (
    typeof fullName === 'string'
        ? fullName.trim().replace(/\u00A0/g, ' ')
        : ''
);

export const getFullNameValidationError = (fullName, options = {}) => {
    const {
        required = true,
        minLength = FULL_NAME_MIN_LENGTH,
        maxLength = FULL_NAME_MAX_LENGTH,
    } = options;

    const normalizedFullName = normalizeFullName(fullName);

    if (!normalizedFullName) {
        return required ? 'Full name is required' : '';
    }

    if (normalizedFullName.length < minLength) {
        return `Full name must be at least ${minLength} characters`;
    }

    if (normalizedFullName.length > maxLength) {
        return `Full name must be at most ${maxLength} characters`;
    }

    if (/\s{2,}/u.test(normalizedFullName)) {
        return 'Full name cannot contain consecutive spaces';
    }

    if (/\d/u.test(normalizedFullName)) {
        return 'Full name cannot contain numbers';
    }

    if (!FULL_NAME_ALLOWED_CHARS_REGEX.test(normalizedFullName)) {
        return "Full name can only contain letters, spaces, hyphens (-), and apostrophes (')";
    }

    if (!FULL_NAME_FORMAT_REGEX.test(normalizedFullName)) {
        return 'Please enter a valid full name';
    }

    return '';
};
