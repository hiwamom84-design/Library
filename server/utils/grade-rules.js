/**
 * Reading-Grade Permission Rules Engine
 * Enforces server-side borrowing authorization based on member grade level.
 *
 * Rules:
 * - Grades 1–3 (grade_level 1..3): G1_3 only
 * - Grades 4–6 (grade_level 4..6): G1_3, G4_6
 * - Grades 7–9 (grade_level 7..9): G1_3, G4_6, G7_9
 * - Grades 10–12 (grade_level 10..12): G1_3, G4_6, G7_9, G10_12 (all except Above grade 12)
 * - Above grade 12 (grade_level >= 13): ALL categories (G1_3, G4_6, G7_9, G10_12, ABOVE_12)
 */

const CATEGORY_CODES = {
  G1_3: 'G1_3',
  G4_6: 'G4_6',
  G7_9: 'G7_9',
  G10_12: 'G10_12',
  ABOVE_12: 'ABOVE_12'
};

const KURDISH_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

function toKurdishNumber(num) {
  return String(num).replace(/\d/g, d => KURDISH_DIGITS[d]);
}

/**
 * Returns allowed category codes for a given grade level
 * @param {number} gradeLevel (1-12 for school grades, 13+ for above grade 12)
 * @returns {Array<string>} Allowed category codes
 */
function getAllowedCategoryCodes(gradeLevel) {
  const grade = parseInt(gradeLevel, 10) || 1;

  if (grade >= 1 && grade <= 3) {
    return [CATEGORY_CODES.G1_3];
  }
  if (grade >= 4 && grade <= 6) {
    return [CATEGORY_CODES.G1_3, CATEGORY_CODES.G4_6];
  }
  if (grade >= 7 && grade <= 9) {
    return [CATEGORY_CODES.G1_3, CATEGORY_CODES.G4_6, CATEGORY_CODES.G7_9];
  }
  if (grade >= 10 && grade <= 12) {
    return [CATEGORY_CODES.G1_3, CATEGORY_CODES.G4_6, CATEGORY_CODES.G7_9, CATEGORY_CODES.G10_12];
  }
  // Grade 13 and above (Adults / Above grade 12)
  return [
    CATEGORY_CODES.G1_3,
    CATEGORY_CODES.G4_6,
    CATEGORY_CODES.G7_9,
    CATEGORY_CODES.G10_12,
    CATEGORY_CODES.ABOVE_12
  ];
}

/**
 * Validates whether a user with given gradeLevel can borrow a book in targetCategoryCode
 * @param {number} userGradeLevel 
 * @param {string} bookCategoryCode 
 * @returns {{ allowed: boolean, reasonCkb: string, reasonEn: string }}
 */
function evaluateBorrowPermission(userGradeLevel, bookCategoryCode) {
  const allowed = getAllowedCategoryCodes(userGradeLevel);
  const isAllowed = allowed.includes(bookCategoryCode);

  if (isAllowed) {
    return {
      allowed: true,
      reasonCkb: 'گونجاوە بۆ ئاستی خوێندنەوەت',
      reasonEn: 'Permitted for your reading grade level'
    };
  }

  return {
    allowed: false,
    reasonCkb: 'ئەم کتێبە تایبەتە بە قۆناغە بەرزترەکانی خوێندنەوە و لەگەڵ پۆلەکەتدا ناگونجێت.',
    reasonEn: 'This book belongs to a higher reading grade category than your registered grade.'
  };
}

/**
 * Format grade level label in Kurdish Sorani and English
 */
function formatGradeLabel(gradeLevel) {
  const g = parseInt(gradeLevel, 10);
  if (g >= 1 && g <= 12) {
    return {
      ckb: `پۆلی ${toKurdishNumber(g)}`,
      en: `Grade ${g}`
    };
  }
  return {
    ckb: 'سەروو پۆلی ١٢ (گەورەساڵان)',
    en: 'Above Grade 12 (Adults)'
  };
}

module.exports = {
  CATEGORY_CODES,
  toKurdishNumber,
  getAllowedCategoryCodes,
  evaluateBorrowPermission,
  formatGradeLabel
};
