import type { Messages } from './en.js'

/** German (formal "Sie"). Keys, placeholders, tag names, URLs and "Supertext" as in en.ts. */
export const de: Messages = {
  'page.title': 'Supertext-Übersetzung',
  'page.back': 'Zurück zu Ghost Admin',
  'page.howTitle': 'So übersetzen Sie',
  'page.howIntro':
    'Öffnen Sie einen Beitrag oder eine Seite in Ghost Admin, fügen Sie in den Beitragseinstellungen einen dieser Tags hinzu und speichern Sie. Wenige Sekunden später erscheint ein übersetzter <strong>Entwurf</strong> in Ihrer Beitragsliste, bereit zum Prüfen und Veröffentlichen.',
  'page.howAll':
    '{translateAll} übersetzt in alle unten aufgeführten Sprachen. {retranslateAll} tut dasselbe und ersetzt auch Übersetzungen, die bearbeitet oder veröffentlicht wurden.',
  'page.jobsTitle': 'Letzte Übersetzungen',
  'page.colWhen': 'Wann',
  'page.colSource': 'Quelle',
  'page.colLanguage': 'Sprache',
  'page.colResult': 'Ergebnis',
  'page.colDetails': 'Details',
  'page.noJobs': 'Noch keine Übersetzungen. Fügen Sie einem Beitrag einen Tag hinzu, um zu beginnen.',
  'page.retranslate': '(neu übersetzen)',
  'page.openTranslation': 'Übersetzung öffnen',
  'page.languagesTitle': 'Sprachen',
  'page.sourceLanguage': 'Ausgangssprache:',
  'page.colTarget': 'Zielsprache',
  'page.colTranslate': 'Übersetzen',
  'page.colRetranslate': 'Neu übersetzen',
  'page.colMarks': 'Kennzeichnet Übersetzungen',
  'page.connectionTitle': 'Verbindung',
  'page.supertextApi': 'Supertext-API',
  'page.apiKey': 'API-Schlüssel',
  'page.configured': 'Eingerichtet',
  'page.missing': 'Fehlt',
  'page.missingKeyHint': '— setzen Sie SUPERTEXT_API_KEY',
  'page.keyHelp':
    'Noch kein Supertext-Konto? <a href="{signupUrl}" target="_blank" rel="noopener">Erstellen Sie eines auf supertext.com</a>. Erzeugen Sie Ihren API-Schlüssel unter <a href="{apiKeyUrl}" target="_blank" rel="noopener">supertext.com → Integrations → API</a> (erfordert die Rolle Admin).',
  'page.ghost': 'Ghost',
  'page.connected': 'Verbunden',
  'page.notConnected': 'Nicht verbunden',
  'page.noGhostKey': 'Es ist kein Ghost-Admin-API-Schlüssel eingerichtet.',
  'page.webhookSignature': 'Webhook-Signatur',
  'page.checked': 'Wird geprüft',
  'page.notChecked': 'Wird nicht geprüft',
  'page.webhookHint': '— legen Sie ein Webhook-Secret fest',
  'page.version': 'Connector-Version',
  'page.signedInAs': 'Angemeldet als',
  'page.ghostStarting': 'Ghost startet, einen Moment bitte …',

  'status.created': 'Erstellt',
  'status.failed': 'Fehlgeschlagen',
  'status.kept': 'Nicht überschrieben',
  'status.running': 'Wird übersetzt …',
  'status.skipped': 'Übersprungen',
  'status.updated': 'Aktualisiert',

  'job.translating': 'Wird übersetzt …',
  'job.interrupted': 'Durch einen Neustart unterbrochen. Entfernen Sie den Tag, speichern Sie und fügen Sie ihn erneut hinzu.',
  'job.isTranslationPost': 'Dieser Beitrag ist selbst eine Übersetzung. Fügen Sie den Tag stattdessen dem Originalbeitrag hinzu.',
  'job.isTranslationPage': 'Diese Seite ist selbst eine Übersetzung. Fügen Sie den Tag stattdessen der Originalseite hinzu.',
  'job.noLexicalPost':
    'Dieser Beitrag hat keinen Inhalt im aktuellen Editorformat von Ghost. Öffnen Sie ihn in Ghost Admin, nehmen Sie eine kleine Änderung vor, speichern Sie und fügen Sie den Tag dann erneut hinzu.',
  'job.noLexicalPage':
    'Diese Seite hat keinen Inhalt im aktuellen Editorformat von Ghost. Öffnen Sie sie in Ghost Admin, nehmen Sie eine kleine Änderung vor, speichern Sie und fügen Sie den Tag dann erneut hinzu.',
  'job.noApiKey':
    'Es ist kein Supertext-API-Schlüssel eingerichtet (SUPERTEXT_API_KEY). Noch kein Supertext-Konto? Erstellen Sie eines auf {signupUrl}. Erzeugen Sie Ihren API-Schlüssel unter {apiKeyUrl} (erfordert die Rolle Admin).',
  'job.keptPublished':
    'Die Übersetzung in {language} ist veröffentlicht und wurde deshalb nicht überschrieben. Fügen Sie {retranslateTag} hinzu, um sie trotzdem zu ersetzen.',
  'job.keptScheduled':
    'Die Übersetzung in {language} ist geplant und wurde deshalb nicht überschrieben. Fügen Sie {retranslateTag} hinzu, um sie trotzdem zu ersetzen.',
  'job.keptSent':
    'Die Übersetzung in {language} wurde versendet und deshalb nicht überschrieben. Fügen Sie {retranslateTag} hinzu, um sie trotzdem zu ersetzen.',
  'job.keptOther':
    'Die Übersetzung in {language} hat den Status {state} und wurde deshalb nicht überschrieben. Fügen Sie {retranslateTag} hinzu, um sie trotzdem zu ersetzen.',
  'job.keptEdited':
    'Die Übersetzung in {language} wurde bearbeitet, nachdem Supertext sie erstellt hat, und deshalb nicht überschrieben. Fügen Sie {retranslateTag} hinzu, um sie trotzdem zu ersetzen.',
  'job.created': 'Entwurf in {language} „{title}“ erstellt.',
  'job.updated': 'Übersetzung in {language} „{title}“ aktualisiert.',
  'job.partly': '{count} Textteil(e) kamen leer zurück und blieben in der Ausgangssprache.',
  'job.unexpected': 'Unerwarteter Fehler: {error}',

  'error.authentication_failure':
    'Authentifizierung fehlgeschlagen. Bitte prüfen Sie Ihren Supertext-API-Schlüssel. Noch kein Supertext-Konto? Erstellen Sie eines auf {signupUrl}. Erzeugen Sie Ihren API-Schlüssel unter {apiKeyUrl} (erfordert die Rolle Admin).',
  'error.file_deleted': 'Die Supertext-Übersetzungsdatei wurde gelöscht, bevor sie heruntergeladen werden konnte.',
  'error.incomplete_response': 'Das übersetzte Dokument war leer.',
  'error.missing_api_key':
    'Es ist kein Supertext-API-Schlüssel eingerichtet. Noch kein Supertext-Konto? Erstellen Sie eines auf {signupUrl}. Erzeugen Sie Ihren API-Schlüssel unter {apiKeyUrl} (erfordert die Rolle Admin).',
  'error.no_file_id': 'Supertext hat keine Datei-ID zurückgegeben.',
  'error.not_found': 'Die angeforderte Supertext-Ressource wurde nicht gefunden.',
  'error.payload_too_large': 'Das Dokument ist zu groß, um von Supertext übersetzt zu werden.',
  'error.quota_exceeded': 'Ihr Supertext-Übersetzungslimit ist überschritten. Bitte erweitern Sie Ihr Abonnement.',
  'error.service_unavailable': 'Der Supertext-Dienst ist nicht verfügbar.',
  'error.timeout': 'Zeitüberschreitung beim Warten auf die Supertext-Übersetzung.',
  'error.too_many_requests': 'Zu viele Anfragen an Supertext. Bitte versuchen Sie es in Kürze erneut.',
  'error.translation_error': 'Supertext konnte das Dokument nicht übersetzen.',
  'error.transport_error': 'Supertext ist nicht erreichbar: {error}',
  'error.unexpected_status': 'Supertext hat einen unerwarteten Statuscode {status} gesendet.',
  'error.detail': '{message} — {detail}',

  'ghost.http': 'Ghost hat mit HTTP {status} geantwortet',
  'ghost.httpDetail': 'Ghost hat mit HTTP {status} geantwortet: {detail}',
  'ghost.noPost': 'Ghost hat keinen Beitrag {id} zurückgegeben',
  'ghost.noPage': 'Ghost hat keine Seite {id} zurückgegeben',

  'tag.translateAll': 'Supertext: Einem Beitrag hinzufügen und speichern, um ihn in alle eingerichteten Sprachen zu übersetzen.',
  'tag.retranslateAll':
    'Supertext: Wie #translate-all, überschreibt aber auch Übersetzungen, die bearbeitet oder veröffentlicht wurden.',
  'tag.translate': 'Supertext: Einem Beitrag hinzufügen und speichern, um einen Entwurf in {language} zu erhalten.',
  'tag.retranslate': 'Supertext: Wie {translateTag}, überschreibt aber auch eine bearbeitete oder veröffentlichte Übersetzung in {language}.',
  'tag.lang': 'Kennzeichnet eine Übersetzung in {language} (von Supertext gesetzt).',
  'tag.results': 'Ergebnisse: {url}',
}
