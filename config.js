// ===== הגדרות חיבור =====
// פרויקט Supabase משותף — קטלוג מוצרים + היסטוריית קבלות + זיהוי AI
window.APP_CONFIG = {
  SUPABASE_URL: "https://kcyoyfoswkcjttvgsnds.supabase.co",
  // מפתח anon (JWT) — בטוח לצד-לקוח, מוגן ע״י RLS. מאמת גם את פונקציית הקצה.
  SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtjeW95Zm9zd2tjanR0dmdzbmRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0OTY3ODUsImV4cCI6MjA5NTA3Mjc4NX0.YCoYwInGjbf-YIpCgybK_MYgqouDDlzQhociYVNv1dk",
  // מאגר מוצרים אמיתי, פתוח וחינמי (שמות, מותגים ותמונות לפי ברקוד)
  OFF_API: "https://world.openfoodfacts.org/api/v2/product/",
  VAT_RATE: 0.18,
};
