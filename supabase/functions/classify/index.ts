import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Converte schema_snapshot Airtable in testo per il prompt
function schemaToPromptText(schema: any): { promptText: string, tableMap: Record<string, { id: string, titleField: string }> } {
  const tableMap: Record<string, { id: string, titleField: string }> = {}
  const lines: string[] = []

  for (const table of schema.tables) {
    lines.push(`### Tabella: ${table.name}`)
    tableMap[table.name] = { id: table.id, titleField: '' }

    for (const field of table.fields) {
      // Salta campi non mappabili da input vocale
      if (['formula', 'rollup', 'lookup', 'createdTime', 'lastModifiedTime', 'createdBy', 'lastModifiedBy', 'autoNumber', 'button'].includes(field.type)) {
        continue
      }

      let fieldDesc = `- ${field.name} (${field.type})`

      if (field.type === 'singleSelect' && field.options?.choices) {
        const options = field.options.choices.map((c: any) => c.name).join(' | ')
        fieldDesc += `: ${options}`
      }
      if (field.type === 'multipleSelects' && field.options?.choices) {
        const options = field.options.choices.map((c: any) => c.name).join(' | ')
        fieldDesc += `: ${options}`
      }
      if (field.type === 'date') {
        fieldDesc += ' — NON compilare mai'
      }

      // Trova il campo titolo (primo campo singleLineText o il campo primary)
      if (field.type === 'singleLineText' && !tableMap[table.name].titleField) {
        tableMap[table.name].titleField = field.name
      }

      lines.push(fieldDesc)
    }
    lines.push('')
  }

  return { promptText: lines.join('\n'), tableMap }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { transcript, user_id } = await req.json()

    if (!transcript || !user_id) {
      throw new Error('transcript e user_id sono obbligatori')
    }

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')

    // Legge connessione e schema da Supabase
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: connection, error: connError } = await supabase
      .from('connections')
      .select('access_token, database_id, schema_snapshot')
      .eq('user_id', user_id)
      .eq('platform', 'airtable')
      .single()

    if (connError || !connection) {
      throw new Error('Nessuna connessione Airtable trovata per questo utente')
    }

    const { access_token, database_id, schema_snapshot } = connection
    const { promptText, tableMap } = schemaToPromptText(schema_snapshot)

    const prompt = `Sei un assistente per la gestione di contenuti. Il tuo compito è analizzare un'idea di contenuto dettata a voce e classificarla secondo lo schema del database.

## Schema del database

${promptText}

## Regole di classificazione

1. ANALIZZA il contenuto dettato e determina in quale tabella (o tabelle) va inserito.
2. Per ogni tabella in cui il contenuto va inserito, COMPILA tutti i campi che puoi dedurre.
3. Se un campo ha opzioni predefinite (singleSelect/multipleSelects), usa SOLO le opzioni esistenti.
4. Se non puoi determinare con certezza il valore di un campo, omettilo.
5. Se il contenuto è adatto a più tabelle, crea un record per ogni tabella.
6. Il campo titolo va sempre compilato.
7. Per i campi singleSelect restituisci una stringa, per i multipleSelects restituisci un array.
8. Non compilare mai campi di tipo date.

## Contenuto dettato

"${transcript}"

## Formato di risposta

Rispondi ESCLUSIVAMENTE con un JSON valido, senza testo aggiuntivo, senza markdown, senza backtick.

{
  "records": [
    {
      "table": "nome esatto della tabella",
      "fields": {
        "nome_campo": "valore per singleLineText/multilineText/singleSelect",
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
      const tableInfo = tableMap[record.table]
      if (!tableInfo) {
        airtableResults.push({ table: record.table, status: 'error', message: 'Tabella non trovata nello schema' })
        continue
      }

      // Aggiunge prefisso ⚡ al campo titolo
      const titleField = tableInfo.titleField
      if (titleField && record.fields[titleField]) {
        record.fields[titleField] = `⚡ ${record.fields[titleField]}`
      }

      // Rimuove campi data per sicurezza
      for (const key of Object.keys(record.fields)) {
        const value = record.fields[key]
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
          delete record.fields[key]
        }
      }

      const airtableResponse = await fetch(
        `https://api.airtable.com/v0/${database_id}/${tableInfo.id}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields: record.fields }),
        }
      )

      const airtableData = await airtableResponse.json()

      if (airtableResponse.ok) {
        airtableResults.push({ table: record.table, status: 'success', id: airtableData.id })
      } else {
        airtableResults.push({ table: record.table, status: 'error', message: JSON.stringify(airtableData) })
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
