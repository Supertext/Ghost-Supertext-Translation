import type { Messages } from './en.js'

/** Italian (formal "Lei"). Keys, placeholders, tag names, URLs and "Supertext" as in en.ts. */
export const it: Messages = {
  'page.title': 'Traduzione Supertext',
  'page.back': 'Torna a Ghost Admin',
  'page.howTitle': 'Come tradurre',
  'page.howIntro':
    'Apra un articolo o una pagina in Ghost Admin, aggiunga uno di questi tag nelle impostazioni dell’articolo e salvi. Pochi secondi dopo, una <strong>bozza</strong> tradotta compare nel Suo elenco degli articoli, pronta per essere rivista e pubblicata.',
  'page.howAll':
    '{translateAll} traduce in tutte le lingue qui sotto. {retranslateAll} fa lo stesso e sostituisce anche le traduzioni modificate o pubblicate.',
  'page.jobsTitle': 'Traduzioni recenti',
  'page.colWhen': 'Quando',
  'page.colSource': 'Originale',
  'page.colLanguage': 'Lingua',
  'page.colResult': 'Risultato',
  'page.colDetails': 'Dettagli',
  'page.noJobs': 'Ancora nessuna traduzione. Aggiunga un tag a un articolo per iniziare.',
  'page.retranslate': '(nuova traduzione)',
  'page.openTranslation': 'Apri traduzione',
  'page.languagesTitle': 'Lingue',
  'page.sourceLanguage': 'Lingua di origine:',
  'page.colTarget': 'Lingua di destinazione',
  'page.colTranslate': 'Traduci',
  'page.colRetranslate': 'Ritraduci',
  'page.colMarks': 'Contrassegna le traduzioni',
  'page.connectionTitle': 'Connessione',
  'page.supertextApi': 'API Supertext',
  'page.apiKey': 'Chiave API',
  'page.configured': 'Configurata',
  'page.missing': 'Mancante',
  'page.missingKeyHint': '— imposti SUPERTEXT_API_KEY',
  'page.keyHelp':
    'Non ha ancora un account Supertext? <a href="{signupUrl}" target="_blank" rel="noopener">Ne crei uno su supertext.com</a>. Generi la Sua chiave API su <a href="{apiKeyUrl}" target="_blank" rel="noopener">supertext.com → Integrations → API</a> (richiede il ruolo Admin).',
  'page.ghost': 'Ghost',
  'page.connected': 'Connesso',
  'page.notConnected': 'Non connesso',
  'page.noGhostKey': 'Nessuna chiave Admin API di Ghost configurata.',
  'page.webhookSignature': 'Firma del webhook',
  'page.checked': 'Verificata',
  'page.notChecked': 'Non verificata',
  'page.webhookHint': '— imposti un segreto per il webhook',
  'page.version': 'Versione del connettore',
  'page.signedInAs': 'Accesso effettuato come',
  'page.ghostStarting': 'Ghost si sta avviando, un momento…',

  'status.created': 'Creato',
  'status.failed': 'Non riuscito',
  'status.kept': 'Non sovrascritto',
  'status.running': 'Traduzione in corso…',
  'status.skipped': 'Saltato',
  'status.updated': 'Aggiornato',

  'job.translating': 'Traduzione in corso…',
  'job.interrupted': 'Interrotto da un riavvio. Rimuova il tag, salvi e lo aggiunga di nuovo.',
  'job.isTranslationPost': 'Questo articolo è già una traduzione. Aggiunga il tag all’articolo originale.',
  'job.isTranslationPage': 'Questa pagina è già una traduzione. Aggiunga il tag alla pagina originale.',
  'job.noLexicalPost':
    'Questo articolo non ha contenuti nel formato attuale dell’editor di Ghost. Lo apra in Ghost Admin, faccia una piccola modifica, salvi e aggiunga di nuovo il tag.',
  'job.noLexicalPage':
    'Questa pagina non ha contenuti nel formato attuale dell’editor di Ghost. La apra in Ghost Admin, faccia una piccola modifica, salvi e aggiunga di nuovo il tag.',
  'job.noApiKey':
    'Nessuna chiave API Supertext configurata (SUPERTEXT_API_KEY). Non ha ancora un account Supertext? Ne crei uno su {signupUrl}. Generi la Sua chiave API su {apiKeyUrl} (richiede il ruolo Admin).',
  'job.keptPublished':
    'La traduzione in {language} è pubblicata, quindi non è stata sovrascritta. Aggiunga {retranslateTag} per sostituirla comunque.',
  'job.keptScheduled':
    'La traduzione in {language} è programmata, quindi non è stata sovrascritta. Aggiunga {retranslateTag} per sostituirla comunque.',
  'job.keptSent':
    'La traduzione in {language} è stata inviata, quindi non è stata sovrascritta. Aggiunga {retranslateTag} per sostituirla comunque.',
  'job.keptOther':
    'La traduzione in {language} ha lo stato {state}, quindi non è stata sovrascritta. Aggiunga {retranslateTag} per sostituirla comunque.',
  'job.keptEdited':
    'La traduzione in {language} è stata modificata dopo che Supertext l’ha creata, quindi non è stata sovrascritta. Aggiunga {retranslateTag} per sostituirla comunque.',
  'job.created': 'Creata la bozza in {language} «{title}».',
  'job.updated': 'Aggiornata la traduzione in {language} «{title}».',
  'job.partly': '{count} parte/i di testo sono tornate vuote e sono rimaste nella lingua di origine.',
  'job.unexpected': 'Errore imprevisto: {error}',

  'error.authentication_failure':
    'Autenticazione non riuscita. Verifichi la Sua chiave API Supertext. Non ha ancora un account Supertext? Ne crei uno su {signupUrl}. Generi la Sua chiave API su {apiKeyUrl} (richiede il ruolo Admin).',
  'error.file_deleted': 'Il file di traduzione Supertext è stato eliminato prima che potesse essere scaricato.',
  'error.incomplete_response': 'Il documento tradotto era vuoto.',
  'error.missing_api_key':
    'Nessuna chiave API Supertext configurata. Non ha ancora un account Supertext? Ne crei uno su {signupUrl}. Generi la Sua chiave API su {apiKeyUrl} (richiede il ruolo Admin).',
  'error.no_file_id': 'Supertext non ha restituito un ID file.',
  'error.not_found': 'La risorsa Supertext richiesta non è stata trovata.',
  'error.payload_too_large': 'Il documento è troppo grande per essere tradotto da Supertext.',
  'error.quota_exceeded': 'Il Suo limite di traduzione Supertext è stato superato. La preghiamo di aggiornare il Suo abbonamento.',
  'error.service_unavailable': 'Il servizio Supertext non è disponibile.',
  'error.timeout': 'Tempo scaduto in attesa del completamento della traduzione Supertext.',
  'error.too_many_requests': 'Troppe richieste a Supertext. Riprovi tra poco.',
  'error.translation_error': 'Supertext non è riuscito a tradurre il documento.',
  'error.transport_error': 'Impossibile raggiungere Supertext: {error}',
  'error.unexpected_status': 'Supertext ha inviato un codice di stato imprevisto: {status}.',
  'error.detail': '{message} — {detail}',

  'ghost.http': 'Ghost ha risposto con HTTP {status}',
  'ghost.httpDetail': 'Ghost ha risposto con HTTP {status}: {detail}',
  'ghost.noPost': 'Ghost non ha restituito l’articolo {id}',
  'ghost.noPage': 'Ghost non ha restituito la pagina {id}',

  'tag.translateAll': 'Supertext: lo aggiunga a un articolo e salvi per tradurlo in tutte le lingue configurate.',
  'tag.retranslateAll': 'Supertext: come #translate-all, ma sovrascrive anche le traduzioni modificate o pubblicate.',
  'tag.translate': 'Supertext: lo aggiunga a un articolo e salvi per ottenere una bozza in {language}.',
  'tag.retranslate': 'Supertext: come {translateTag}, ma sovrascrive anche una traduzione in {language} modificata o pubblicata.',
  'tag.lang': 'Contrassegna una traduzione in {language} (impostato da Supertext).',
  'tag.results': 'Risultati: {url}',
}
