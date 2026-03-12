import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://ofdqkracfqakbtjjmksa.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mZHFrcmFjZnFha2J0ampta3NhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwODMyNzMsImV4cCI6MjA4NDY1OTI3M30.GF7AgOem5ZjLoLgZtcHB5d6uODNFPTmT4u98MsGEbhM'

console.log('WASEL_DEBUG: Supabase initializing...');
console.log('WASEL_DEBUG: URL =', supabaseUrl);
console.log('WASEL_DEBUG: Key exists =', !!supabaseAnonKey);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    lock: async (name, acquireTimeout, fn) => await fn(),
  }
});

console.log('WASEL_DEBUG: Supabase client created');
