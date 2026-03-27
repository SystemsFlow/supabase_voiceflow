const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const AIRTABLE_TABLES: Record<string, string> = {
  'Blog Posts': 'tblevAnAAPpsREQXi',
  'Social Media Posts': 'tblNv9mvkEaz7Pf9E',
  'Email Campaigns': 'tblM2nkYOGaTJJcVb',
  'Instagram Stories': 'tblAt8cbZRfTSInSd',
  'Video Youtube': 'tblYJqkIMEebhzlJs',
}

const AIRTABLE_BASE = 'app70Q7WUIlmNUJr4'

const TITLE_FIELDS: Record<string, string> = {
  'Blog Posts': 'Title',
  'Social Media Posts': 'Name',
  'Email Campaigns': 'Nome',
  'Instagram Stories': 'Name',
  'Video Youtube': 'Titolo video',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { transcript } = await req.json()

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    const airtableToken = Deno.env.get('AIRTABLE_TOKEN')

    const prompt = `Sei un assistente per la gestione di contenuti. Il tuo compito è analizzare un'idea di contenuto dettata a voce e classificarla secondo lo schema del database.

## Schema del database

### Tabella: Blog Posts
- Title (title): testo libero — titolo o gancio dell'articolo
- Tema (multi_select): Ecosistemi | Ordine digitale | Task&Project management | Social | Automazioni | SOP | Mindset | Tool
- Status (single_select): Bozza | Idea | Da revisionare | Pianificato | Pubblicato
- Funnel (single_select): ToFu | MoFu | BoFu
- Tipologia articolo (multi_select): Pillar | Cluster | Case study
- Publication Date (date): data
- Body (rich_text): testo libero

### Tabella: Social Media Posts
- Name (title): testo libero — gancio o titolo del post
- Post Content (rich_text): testo libero — testo del post o idea
- Tipo contenuto (single_select): Carosello | Reel
- CTA (multi_select): Commenta | Salva | Like | Follow | Share | DM/Manychat
- Scheduled Date (date): data

### Tabella: Email Campaigns
- Nome (title): testo libero — oggetto o titolo della campagna
- Oggetto (rich_text): testo libero
- Preheader (rich_text): testo libero
- Corpo (rich_text): testo libero — contenuto o idea
- Type (single_select): Flow Letter | DEM
- Data invio (date): data

### Tabella: Instagram Stories
- Name (title): testo libero — titolo o idea della story
- Notes (rich_text): testo libero — contenuto o idea
- Tema (multi_select): Ecosistemi | Ordine digitale | Task&Project management | Social | Automazioni | SOP | Mindset | Tool
- Data pubblicazione (date): data

### Tabella: Video Youtube
- Titolo video (title): testo libero — titolo del video
- Descrizione Video (rich_text): testo libero — idea o scaletta
- Tag Video (rich_text): testo libero — parole chiave
- Data Pubblicazione (date): data

## Regole di classificazione

1. ANALIZZA il contenuto dettato e determina in quale tabella (o tabelle) va inserito.
2. Per ogni tabella in cui il contenuto va inserito, COMPILA tutti i campi che puoi dedurre.
3. Se un campo ha opzioni predefinite (single_select/multi_select), usa SOLO le opzioni esistenti.
4. Se non puoi determinare con certezza il valore di un campo, omettilo.
5. Se il contenuto è adatto a più tabelle, crea un record per ogni tabella.
6. Il campo titolo va sempre compilato.
7. Per i campi single_select restituisci una stringa, per i multi_select restituisci un array.
8. Non compilare mai campi di tipo data. I record sono sempre bozze o idee: la data viene gestita manualmente in un secondo momento.

## Contenuto dettato

"${transcript}"

## Formato di risposta

Rispondi ESCLUSIVAMENTE con un JSON valido, senza testo aggiuntivo, senza markdown, senza backtick.

{
  "records": [
    {
      "table": "nome esatto della tabella",
      "fields": {
        "nome_campo": "valore per title/text/single_select",
        "nome_campo_multi": ["valore1", "valore2"]
      },
      "confidence": "high" | "medium" | "low",
      "notes": "eventuale nota"
    }
  ]
}`

    // Chiamata Claude API
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const claudeData = await claudeResponse.json()
    const classification = JSON.parse(claudeData.content[0].text)

    // Scrittura in Airtable
    const airtableResults = []

    for (const record of classification.records) {
      const tableId = AIRTABLE_TABLES[record.table]
      if (!tableId) {
        airtableResults.push({ table: record.table, status: 'error', message: 'Tabella non trovata' })
        continue
      }

      // Aggiunge prefisso ⚡ al campo titolo
      const titleField = TITLE_FIELDS[record.table]
      if (titleField && record.fields[titleField]) {
        record.fields[titleField] = `⚡ ${record.fields[titleField]}`
      }

      // Rimuove eventuali campi data (sicurezza aggiuntiva)
      for (const key of Object.keys(record.fields)) {
        const value = record.fields[key]
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
          delete record.fields[key]
        }
      }

      const airtableResponse = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE}/${tableId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${airtableToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields: record.fields }),
        }
      )

      const airtableData = await airtableResponse.json()

      if (airtableResponse.ok) {
        airtableResults.push({ table: record.table, status: 'success', id: airtableData.id })
      } else {
        airtableResults.push({ table: record.table, status: 'error', message: airtableData.error?.message })
      }
    }

    return new Response(
      JSON.stringify({ classification, airtableResults }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
