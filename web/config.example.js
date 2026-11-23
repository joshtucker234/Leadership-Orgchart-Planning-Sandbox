// Public by design: the publishable key only works through row-level security, which allows
// only addresses in the allowed_emails table. Never put the secret key here.
window.SB_CONFIG = {
  url: 'https://YOUR-PROJECT-REF.supabase.co',
  key: 'YOUR_PUBLISHABLE_KEY',
};
