// Dopo aver letto connection da Supabase, aggiungi questo blocco:

let { access_token, refresh_token, token_expires_at } = connection

// Controlla se il token è scaduto o sta per scadere (margine 5 minuti)
const isExpired = token_expires_at
  ? new Date(token_expires_at).getTime() - Date.now() < 5 * 60 * 1000
  : false

if (isExpired && refresh_token) {
  console.log('Token scaduto, refresh in corso...')
  const clientId = Deno.env.get('AIRTABLE_CLIENT_ID')
  const clientSecret = Deno.env.get('AIRTABLE_CLIENT_SECRET')

  const refreshResponse = await fetch('https://www.airtable.com/oauth2/v1/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token,
    }),
  })

  const refreshData = await refreshResponse.json()
  if (!refreshResponse.ok) {
    throw new Error('Refresh token fallito — riconnetti Airtable')
  }

  access_token = refreshData.access_token
  const newExpiresAt = new Date(Date.now() + (refreshData.expires_in ?? 3600) * 1000).toISOString()

  await supabase
    .from('connections')
    .update({
      access_token,
      refresh_token: refreshData.refresh_token ?? refresh_token,
      token_expires_at: newExpiresAt,
    })
    .eq('user_id', user_id)
    .eq('platform', 'airtable')

  console.log('Token refreshato OK')
}
