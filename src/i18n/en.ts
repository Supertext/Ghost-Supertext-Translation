/**
 * English messages: the source and fallback for de, fr and it.
 *
 * `{name}` is a placeholder. A placeholder called `{language}` gets a language code and is
 * shown as that language's name in the reader's language. Status page strings may contain
 * HTML; job messages and tag descriptions are plain text.
 */
export const en = {
  // Status page
  'page.title': 'Supertext Translation',
  'page.back': 'Back to Ghost Admin',
  'page.howTitle': 'How to translate',
  'page.howIntro':
    'Open a post or page in Ghost Admin, add one of these tags in the post settings, and save. A few seconds later a translated <strong>draft</strong> appears in your posts list, ready to review and publish.',
  'page.howAll':
    '{translateAll} translates into every language below. {retranslateAll} does the same and also replaces translations that were edited or published.',
  'page.jobsTitle': 'Recent translations',
  'page.colWhen': 'When',
  'page.colSource': 'Source',
  'page.colLanguage': 'Language',
  'page.colResult': 'Result',
  'page.colDetails': 'Details',
  'page.noJobs': 'No translations yet. Add a tag to a post to start.',
  'page.retranslate': '(retranslate)',
  'page.openTranslation': 'Open translation',
  'page.languagesTitle': 'Languages',
  'page.sourceLanguage': 'Source language:',
  'page.colTarget': 'Target language',
  'page.colTranslate': 'Translate',
  'page.colRetranslate': 'Retranslate',
  'page.colMarks': 'Marks translations',
  'page.connectionTitle': 'Connection',
  'page.supertextApi': 'Supertext API',
  'page.apiKey': 'API key',
  'page.configured': 'Configured',
  'page.missing': 'Missing',
  'page.missingKeyHint': '— set SUPERTEXT_API_KEY',
  'page.keyHelp':
    'No Supertext account yet? <a href="{signupUrl}" target="_blank" rel="noopener">Create one at supertext.com</a>. Generate your API key at <a href="{apiKeyUrl}" target="_blank" rel="noopener">supertext.com → Integrations → API</a> (requires the Admin role).',
  'page.ghost': 'Ghost',
  'page.connected': 'Connected',
  'page.notConnected': 'Not connected',
  'page.noGhostKey': 'No Ghost Admin API key is configured.',
  'page.webhookSignature': 'Webhook signature',
  'page.checked': 'Checked',
  'page.notChecked': 'Not checked',
  'page.webhookHint': '— set a webhook secret',
  'page.version': 'Connector version',
  'page.signedInAs': 'Signed in as',
  'page.ghostStarting': 'Ghost is starting, one moment…',

  // Result badges
  'status.created': 'Created',
  'status.failed': 'Failed',
  'status.kept': 'Not overwritten',
  'status.running': 'Translating…',
  'status.skipped': 'Skipped',
  'status.updated': 'Updated',

  // Job messages
  'job.translating': 'Translating…',
  'job.interrupted': 'Interrupted by a restart. Remove the tag, save, and add it again.',
  'job.isTranslationPost': 'This post is itself a translation. Add the tag to the original post instead.',
  'job.isTranslationPage': 'This page is itself a translation. Add the tag to the original page instead.',
  'job.noLexicalPost':
    "This post has no content in Ghost's current editor format. Open it in Ghost Admin, make any small change, save, then add the tag again.",
  'job.noLexicalPage':
    "This page has no content in Ghost's current editor format. Open it in Ghost Admin, make any small change, save, then add the tag again.",
  'job.noApiKey':
    'No Supertext API key is configured (SUPERTEXT_API_KEY). No Supertext account yet? Create one at {signupUrl}. Generate your API key at {apiKeyUrl} (requires the Admin role).',
  'job.keptPublished':
    'The {language} translation is published, so it was not overwritten. Add {retranslateTag} to replace it anyway.',
  'job.keptScheduled':
    'The {language} translation is scheduled, so it was not overwritten. Add {retranslateTag} to replace it anyway.',
  'job.keptSent': 'The {language} translation was sent, so it was not overwritten. Add {retranslateTag} to replace it anyway.',
  'job.keptOther':
    'The {language} translation is {state}, so it was not overwritten. Add {retranslateTag} to replace it anyway.',
  'job.keptEdited':
    'The {language} translation was edited after Supertext created it, so it was not overwritten. Add {retranslateTag} to replace it anyway.',
  'job.created': 'Created the {language} draft "{title}".',
  'job.updated': 'Updated the {language} translation "{title}".',
  'job.partly': '{count} text part(s) came back empty and stayed in the source language.',
  'job.unexpected': 'Unexpected error: {error}',

  // Supertext API errors (SupertextError codes)
  'error.authentication_failure':
    'Authentication failure. Please check your Supertext API key. No Supertext account yet? Create one at {signupUrl}. Generate your API key at {apiKeyUrl} (requires the Admin role).',
  'error.file_deleted': 'The Supertext translation file was deleted before it could be downloaded.',
  'error.incomplete_response': 'The translated document was empty.',
  'error.missing_api_key':
    'No Supertext API key is configured. No Supertext account yet? Create one at {signupUrl}. Generate your API key at {apiKeyUrl} (requires the Admin role).',
  'error.no_file_id': 'Supertext did not return a file id.',
  'error.not_found': 'The requested Supertext resource was not found.',
  'error.payload_too_large': 'The document is too large for Supertext to translate.',
  'error.quota_exceeded': 'Your Supertext translation limit is exceeded. Please upgrade your subscription.',
  'error.service_unavailable': 'Supertext service unavailable.',
  'error.timeout': 'Timed out waiting for the Supertext translation to finish.',
  'error.too_many_requests': 'Too many requests to Supertext. Please try again shortly.',
  'error.translation_error': 'Supertext failed to translate the document.',
  'error.transport_error': 'Could not reach Supertext: {error}',
  'error.unexpected_status': 'Supertext sent an unexpected status code {status}.',
  'error.detail': '{message} — {detail}',

  // Ghost Admin API errors
  'ghost.http': 'Ghost answered HTTP {status}',
  'ghost.httpDetail': 'Ghost answered HTTP {status}: {detail}',
  'ghost.noPost': 'Ghost returned no post {id}',
  'ghost.noPage': 'Ghost returned no page {id}',

  // Descriptions of the internal tags in Ghost Admin → Tags (plain text)
  'tag.translateAll': 'Supertext: add to a post and save to translate it into every configured language.',
  'tag.retranslateAll': 'Supertext: like #translate-all, but also overwrites translations that were edited or published.',
  'tag.translate': 'Supertext: add to a post and save to get a {language} draft.',
  'tag.retranslate': 'Supertext: like {translateTag}, but also overwrites an edited or published {language} translation.',
  'tag.lang': 'Marks a {language} translation (set by Supertext).',
  'tag.results': 'Results: {url}',
} as const

export type MessageKey = keyof typeof en
export type Messages = Record<MessageKey, string>
