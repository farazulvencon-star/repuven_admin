/* Project settings. The anon key is a public key by design: every table is protected
   by row level security in Supabase, and money actions run only through checked
   database functions. Never put a service-role key or any other secret here. */
const SUPABASE_URL = "https://dybotlvvfiqlouzvhvkg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5Ym90bHZ2ZmlxbG91enZodmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MTQ4NDAsImV4cCI6MjA5ODQ5MDg0MH0.V_zO5gA4muDMalr2SR0Ui269E62f5vm4h8s_NarwV8Y";
