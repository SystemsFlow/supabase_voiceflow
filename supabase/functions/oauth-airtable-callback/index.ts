import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  console.log('STEP 1 - params:', { code: !!code, state: !!state, error: errorParam })

  if (errorParam) {
    return Response.redirect('https://voiceflowidea.lovable.app/dashboard?oauth_error=true&reason=' + errorParam, 302)
  }

  if (!code || !state) {
    console.log('STEP 1 FAIL - missing code or state')
    return new Response(JSON.stringify({ error: 'Missing code or state' }), { status: 400 })
  }

  let user_id: string
  let verifier: string
  try {
    const decoded = JSON.parse(atob(state))
    user_id = decoded.user_id
    verifier = decoded.verifier
    console.log('STEP 2 - user_id:', user_id, 'verifier present:', !!verifier)
  } catch (e) {
    console.log('STEP 2 FAIL - state decode error:', e.message)
    return new Response(JSON.stringify({ error: 'Invalid state' }), { status: 400 })
  }

  const clientId = Deno.env.get('AIRTABLE_CLIENT_ID')
  const clientSecret = Deno.env.get('AIRTABLE_CLIENT_SECRET')
  const redirectUri = 'https://dpdkfppswzimvonmjaiu.supabase.co/functions/v1/oauth-airtable-callback'

  let accessToken: string
  try {
    const tokenResponse = await fetch('https://www.airtable.com/oauth2/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    })
    const tokenData = await tokenResponse.json()
    console.log('STEP 3 - token response:', JSON.stringify(tokenData))
    if (!tokenResponse.ok) {
      return new Response(JSON.stringify({ error: 'Token exchange failed', detail: tokenData }), { status: 400 })
    }
    accessToken = tokenData.access_token
  } catch (e) {
    console.log('STEP 3 FAIL:', e.message)
    return new Response(JSON.stringify({ error: 'Token fetch error', detail: e.message }), { status: 500 })
  }

  let baseId: string
  try {
    const basesResponse = await fetch('https://api.airtable.com/v0/meta/bases', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    })
    const basesData = await basesResponse.json()
    console.log('STEP 4 - bases:', JSON.stringify(basesData))
    baseId = basesData.bases[0].id
  } catch (e) {
    console.log('STEP 4 FAIL:', e.message)
    return new Response(JSON.stringify({ error: 'Bases fetch error', detail: e.message }), { status: 500 })
  }

  let schemaData: any
  try {
    const schemaResponse = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    })
    schemaData = await schemaResponse.json()
    console.log('STEP 5 - schema tables count:', schemaData.tables?.length)
  } catch (e) {
    console.log('STEP 5 FAIL:', e.message)
    return new Response(JSON.stringify({ error: 'Schema fetch error', detail: e.message }), { status: 500 })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const { error: dbError } = await supabase
      .from('connections')
      .upsert({
        user_id,
        platform: 'airtable',
        access_token: accessToken,
        database_id: baseId,
        schema_snapshot: schemaData,
        connected_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      }, { onConflict: 'user_id,platform' })

    if (dbError) {
      console.log('STEP 6 FAIL - db error:', dbError.message)
      return new Response(JSON.stringify({ error: 'DB error', detail: dbError.message }), { status: 500 })
    }
    console.log('STEP 6 - saved to Supabase OK')
  } catch (e) {
    console.log('STEP 6 FAIL:', e.message)
    return new Response(JSON.stringify({ error: 'DB error', detail: e.message }), { status: 500 })
  }

  console.log('STEP 7 - redirecting to dashboard')
  return Response.redirect('https://voiceflowidea.lovable.app/dashboard?connected=true', 302)
})
