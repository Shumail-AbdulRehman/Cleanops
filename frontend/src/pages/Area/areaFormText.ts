import { useLanguage } from '@/i18n/context';

/** Built-in setup copy only. Persisted names, instructions and evidence stay unchanged. */
const urdu: Record<string, string> = {
  'Create cleaning schedule': 'صفائی کا شیڈول بنائیں',
  'Set up the work, team, and time before saving.': 'محفوظ کرنے سے پہلے کام، عملہ اور وقت طے کریں۔',
  'Schedule creation steps': 'شیڈول بنانے کے مراحل',
  'Task': 'کام', 'Team': 'عملہ', 'Schedule': 'شیڈول', 'Review': 'جائزہ',
  'Task title': 'کام کا عنوان', 'Instructions (optional)': 'ہدایات (اختیاری)',
  'Clean the lobby': 'لابی صاف کریں', 'What should the team do?': 'عملے کو کیا کرنا چاہیے؟',
  'Area template': 'علاقے کا سانچہ', 'Choose one area': 'ایک علاقہ منتخب کریں',
  'Loading inventory…': 'سامان کی فہرست لوڈ ہو رہی ہے…',
  'Area inventory could not load. Retry before continuing.': 'علاقے کی فہرست لوڈ نہیں ہو سکی۔ آگے بڑھنے سے پہلے دوبارہ کوشش کریں۔',
  'Retry loading areas': 'علاقے دوبارہ لوڈ کریں',
  'Set up and activate an area first.': 'پہلے علاقے کا سانچہ بنائیں اور فعال کریں۔',
  'Add area': 'علاقہ شامل کریں',
  'Automatic assignment remains available. You can choose a specific person who works at this location.': 'خودکار تفویض دستیاب ہے۔ آپ اس مقام پر کام کرنے والا مخصوص کارکن بھی منتخب کر سکتے ہیں۔',
  'Assign staff': 'کارکن مقرر کریں', 'Use automatic assignment': 'خودکار تفویض استعمال کریں',
  'Repeat': 'تکرار', 'Daily': 'روزانہ', 'Once': 'ایک بار', 'Effective date': 'نافذ ہونے کی تاریخ',
  'Start time': 'شروع ہونے کا وقت', 'End time': 'ختم ہونے کا وقت',
  'Repeat until (optional)': 'اس تاریخ تک دہرائیں (اختیاری)',
  'Daily schedules include every day, including weekends. Dates and times follow this location’s timezone.': 'روزانہ کے شیڈول میں ہفتے کے اختتام سمیت ہر دن شامل ہے۔ تاریخ اور وقت اس مقام کے ٹائم زون کے مطابق ہیں۔',
  'Location': 'مقام', 'Fixtures': 'فکسچر',
  '{count} selected items': '{count} منتخب اشیا',
  '{mandatory} mandatory fixtures, {optional} optional fixtures, {photos} required photos.': '{mandatory} لازمی فکسچر، {optional} اختیاری فکسچر، {photos} ضروری تصاویر۔',
  'Mandatory items require every mandatory evidence view to pass.': 'لازمی اشیا کے ہر ضروری تصویری منظر کی جانچ کامیاب ہونا ضروری ہے۔',
  '{repeat} from {start}': '{start} سے {repeat}', 'Until {date}': '{date} تک',
  'A task QR is available only after an occurrence exists. Previewing a future slot does not generate a task.': 'کام کا کیو آر اس کی مثال تیار ہونے کے بعد دستیاب ہوگا۔ آنے والا وقت دیکھنے سے کام تیار نہیں ہوتا۔',
  'Cancel': 'منسوخ کریں', 'Back': 'واپس', 'Next': 'اگلا', 'Creating…': 'بنایا جا رہا ہے…',
  'Assigning…': 'تفویض کیا جا رہا ہے…', 'Create schedule': 'شیڈول بنائیں',
  'Schedule saved as #{id}': 'شیڈول نمبر {id} محفوظ ہو گیا',
  'Retry assignment': 'تفویض دوبارہ کریں', 'Keep schedule and finish': 'شیڈول برقرار رکھ کر مکمل کریں',
  'Close and check schedule list': 'بند کر کے شیڈول کی فہرست دیکھیں',
  'Schedule created. Staff assignment could not be confirmed.': 'شیڈول بن گیا۔ کارکن کی تفویض کی تصدیق نہیں ہو سکی۔',
  'Creation could not be confirmed. Check this location’s schedule list before trying again.': 'شیڈول بننے کی تصدیق نہیں ہو سکی۔ دوبارہ کوشش سے پہلے اس مقام کی شیڈول فہرست دیکھیں۔',
  'Could not save the schedule. Check the fields and try again.': 'شیڈول محفوظ نہیں ہو سکا۔ درج معلومات دیکھ کر دوبارہ کوشش کریں۔',
  'Inventory refreshed. Review the selected fixtures before retrying. Your draft is preserved.': 'فہرست تازہ ہو گئی۔ دوبارہ کوشش سے پہلے منتخب فکسچر دیکھیں۔ آپ کا مسودہ محفوظ ہے۔',
  'Inventory could not refresh. Your draft is preserved. Retry loading areas.': 'فہرست تازہ نہیں ہو سکی۔ آپ کا مسودہ محفوظ ہے۔ علاقے دوبارہ لوڈ کریں۔',
  'Choose {date} or a later date for {location}.': '{location} کے لیے {date} یا اس کے بعد کی تاریخ منتخب کریں۔',
  'Add a task title.': 'کام کا عنوان لکھیں۔', 'Choose one area.': 'ایک علاقہ منتخب کریں۔',
  'Choose at least one mandatory item.': 'کم از کم ایک لازمی شے منتخب کریں۔',
  'An inventory item can only be selected once.': 'فہرست کی ایک شے صرف ایک بار منتخب کی جا سکتی ہے۔',
  'An item can only be selected once.': 'ایک شے صرف ایک بار منتخب کی جا سکتی ہے۔',
  'Choose active items from this area only.': 'صرف اسی علاقے کی فعال اشیا منتخب کریں۔',
  'A mandatory fixture requires at least one mandatory view.': 'لازمی فکسچر کے لیے کم از کم ایک لازمی تصویری منظر ضروری ہے۔',
  'Choose an active area from the latest inventory.': 'تازہ فہرست سے ایک فعال علاقہ منتخب کریں۔',
  'Choose a date, start time, and end time.': 'تاریخ، شروع اور ختم ہونے کا وقت منتخب کریں۔',
  'The repeat end date must be on or after the effective date.': 'تکرار ختم ہونے کی تاریخ نافذ ہونے کی تاریخ یا اس کے بعد ہونی چاہیے۔',
  'Required inventory': 'ضروری اشیا', 'All active items': 'تمام فعال اشیا',
  'Choose items for this task': 'اس کام کے لیے اشیا منتخب کریں',
  'Changes apply to future tasks. Each generated task keeps its original requirements.': 'تبدیلیاں آئندہ کاموں پر لاگو ہوں گی۔ ہر تیار شدہ کام کی اصل شرائط برقرار رہیں گی۔',
  'Include {name}': '{name} شامل کریں', 'Mandatory: {name}': 'لازمی: {name}', 'Mandatory': 'لازمی',
  'Loading saved inventory…': 'محفوظ فہرست لوڈ ہو رہی ہے…',
  'Saved inventory could not be loaded.': 'محفوظ فہرست لوڈ نہیں ہو سکی۔',
  'Retry inventory': 'فہرست دوبارہ لوڈ کریں', 'Future inventory: {name}': 'آئندہ کی فہرست: {name}',
  'Future inventory saved. Current tasks retain their requirements.': 'آئندہ کی فہرست محفوظ ہو گئی۔ موجودہ کاموں کی شرائط برقرار ہیں۔',
  'Could not save inventory. Check your connection and try again.': 'فہرست محفوظ نہیں ہو سکی۔ انٹرنیٹ دیکھ کر دوبارہ کوشش کریں۔',
  'The saved inventory changed elsewhere. Review your preserved selection before retrying.': 'محفوظ فہرست کہیں اور تبدیل ہو گئی۔ دوبارہ کوشش سے پہلے اپنی محفوظ انتخاب دیکھیں۔',
  'Inventory saved, but the latest view could not refresh. Reload to see saved requirements.': 'فہرست محفوظ ہو گئی، مگر تازہ منظر لوڈ نہیں ہو سکا۔ محفوظ شرائط دیکھنے کے لیے دوبارہ لوڈ کریں۔',
  'Saving inventory…': 'فہرست محفوظ ہو رہی ہے…', 'Save future inventory': 'آئندہ کی فہرست محفوظ کریں',
  'This action is not allowed. Check your role and workspace access.': 'اس اقدام کی اجازت نہیں۔ اپنا کردار اور ورک اسپیس کی رسائی دیکھیں۔',
  'This setup changed elsewhere. Review the latest version before saving again.': 'یہ ترتیب کہیں اور تبدیل ہو گئی۔ دوبارہ محفوظ کرنے سے پہلے تازہ حالت دیکھیں۔',
  'This setup record is no longer available. Reload and try again.': 'ترتیب کا یہ ریکارڈ اب دستیاب نہیں۔ دوبارہ لوڈ کر کے کوشش کریں۔',
  'Too many requests. Wait and try again.': 'بہت زیادہ درخواستیں ہو گئیں۔ کچھ دیر بعد دوبارہ کوشش کریں۔',
  'Area creation could not be confirmed. Close and check the area list before trying again.': 'علاقہ بننے کی تصدیق نہیں ہو سکی۔ دوبارہ کوشش سے پہلے بند کر کے علاقے کی فہرست دیکھیں۔',
  'Close and check areas': 'بند کر کے علاقے دیکھیں',
  'Prepare area template': 'علاقے کا سانچہ تیار کریں', 'Edit area template': 'علاقے کا سانچے میں ترمیم کریں',
  'Add area template': 'علاقے کا سانچہ شامل کریں', 'Close editor': 'ایڈیٹر بند کریں',
  'Name the area and choose what staff need to clean.': 'علاقے کا نام لکھیں اور عملے کے صاف کرنے کی اشیا منتخب کریں۔',
  'Loading area template…': 'علاقے کا سانچہ لوڈ ہو رہا ہے…', 'Area template could not be loaded.': 'علاقے کا سانچہ لوڈ نہیں ہو سکا۔',
  'Area name': 'علاقے کا نام', 'East washroom': 'مشرقی واش روم', 'Area type': 'علاقے کی قسم',
  'Washroom': 'واش روم', 'General room': 'عام کمرہ', 'Cleaning instructions (optional)': 'صفائی کی ہدایات (اختیاری)',
  '{count} fixtures selected': '{count} فکسچر منتخب', 'Choose at most 200 fixtures.': 'زیادہ سے زیادہ 200 فکسچر منتخب کریں۔',
  'Choose at least one fixture.': 'کم از کم ایک فکسچر منتخب کریں۔', 'Area name is required.': 'علاقے کا نام ضروری ہے۔',
  'Saving…': 'محفوظ کیا جا رہا ہے…', 'Save changes': 'تبدیلیاں محفوظ کریں', 'Create area template': 'علاقے کا سانچہ بنائیں',
  'Activate area': 'علاقہ فعال کریں', 'Add fixtures': 'فکسچر شامل کریں', 'Fixture type': 'فکسچر کی قسم', 'Count': 'تعداد',
  'Fixture name': 'فکسچر کا نام', 'Status': 'حالت', 'Active': 'فعال', 'Maintenance': 'دیکھ بھال',
  'Remove from template': 'سانچے سے ہٹائیں', 'Save fixture': 'فکسچر محفوظ کریں', 'Edit': 'ترمیم', 'Edit {name}': '{name} میں ترمیم کریں',
  'Template changes apply to future tasks. Existing tasks keep their required photos.': 'سانچے کی تبدیلیاں آئندہ کاموں پر لاگو ہوں گی۔ موجودہ کاموں کی ضروری تصاویر برقرار رہیں گی۔',
  'Archive this template? It will no longer be available for new schedules. Existing tasks and evidence stay saved.': 'یہ سانچہ محفوظ شدہ فہرست میں منتقل کریں؟ یہ نئے شیڈول کے لیے دستیاب نہیں ہوگا۔ موجودہ کام اور ثبوت محفوظ رہیں گے۔',
  'Confirm archive': 'منتقلی کی تصدیق کریں', 'Archive template': 'سانچہ محفوظ شدہ فہرست میں منتقل کریں',
  'Area template created.': 'علاقے کا سانچہ بن گیا۔', 'Area template saved.': 'علاقے کا سانچہ محفوظ ہو گیا۔',
  'Area template activated.': 'علاقے کا سانچہ فعال ہو گیا۔', 'Area template archived.': 'علاقے کا سانچہ محفوظ شدہ فہرست میں منتقل ہو گیا۔',
  'Fixtures added.': 'فکسچر شامل ہو گئے۔', 'Fixture saved.': 'فکسچر محفوظ ہو گیا۔',
  'The template was refreshed. Your edits are preserved; review them and save again.': 'سانچہ تازہ ہو گیا۔ آپ کی ترمیم محفوظ ہے؛ جائزہ لے کر دوبارہ محفوظ کریں۔',
  'The template could not refresh. Your edits are preserved. Retry loading it.': 'سانچہ تازہ نہیں ہو سکا۔ آپ کی ترمیم محفوظ ہے۔ دوبارہ لوڈ کریں۔',
  'Could not save the area template. Check the fields and try again.': 'علاقے کا سانچہ محفوظ نہیں ہو سکا۔ معلومات دیکھ کر دوبارہ کوشش کریں۔',
  'Toilet': 'ٹوائلٹ', 'Indian toilet': 'دیسی ٹوائلٹ', 'Western toilet': 'مغربی ٹوائلٹ', 'Sink': 'بیسن',
  'Mirror': 'آئینہ', 'Bin': 'کوڑے دان', 'Floor zone': 'فرش کا حصہ', 'Fixture': 'فکسچر', 'Retry': 'دوبارہ کوشش کریں',
};

export function useSetupFormText() {
  const { language, t } = useLanguage();
  return (text: string, values?: Record<string, string | number>) => {
    const translated = language === 'ur' ? urdu[text] ?? t(text) : text;
    return translated.replace(/\{(\w+)\}/g, (match, key: string) => String(values?.[key] ?? match));
  };
}

/** Use bounded workflow copy rather than raw transport/provider error messages. */
export function setupErrorKey(error: unknown, fallback: string): string {
  const response = (error as { response?: { status?: number; data?: { message?: string } } })?.response;
  const message = response?.data?.message;
  if (message && Object.hasOwn(urdu, message)) return message;
  if (response?.status === 403) return 'This action is not allowed. Check your role and workspace access.';
  if (response?.status === 404) return 'This setup record is no longer available. Reload and try again.';
  if (response?.status === 409) return 'This setup changed elsewhere. Review the latest version before saving again.';
  if (response?.status === 429) return 'Too many requests. Wait and try again.';
  return fallback;
}
