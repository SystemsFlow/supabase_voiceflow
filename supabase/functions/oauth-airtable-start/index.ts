const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function generatePKCE() {
  const verifier = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  return { verifier, challenge }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const clientId = Deno.env.get('AIRTABLE_CLIENT_ID')
    const redirectUri = 'https://dpdkfppswzimvonmjaiu.supabase.co/functions/v1/oauth-airtable-callback'

    const { user_id } = await req.json()
    const { verifier, challenge } = await generatePKCE()

    const state = btoa(JSON.stringify({ user_id, verifier }))

    const authUrl = `https://www.airtable.com/oauth2/v1/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=data.records%3Aread%20data.records%3Awrite%20schema.bases%3Aread&state=${encodeURIComponent(state)}&code_challenge=${challenge}&code_challenge_method=S256`

    return new Response(
      JSON.stringify({ url: authUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
