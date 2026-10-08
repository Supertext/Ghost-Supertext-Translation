import type { Messages } from './en.js'

/**
 * French (formal "vous"). Keys, placeholders, tag names, URLs and "Supertext" as in en.ts.
 * ` ` is the non-breaking space before ? ! : ; and inside « ».
 */
export const fr: Messages = {
  'page.title': 'Traduction Supertext',
  'page.back': 'Retour à Ghost Admin',
  'page.howTitle': 'Comment traduire',
  'page.howIntro':
    'Ouvrez un article ou une page dans Ghost Admin, ajoutez l’un de ces tags dans les paramètres de l’article, puis enregistrez. Quelques secondes plus tard, un <strong>brouillon</strong> traduit apparaît dans votre liste d’articles, prêt à être relu et publié.',
  'page.howAll':
    '{translateAll} traduit dans toutes les langues ci-dessous. {retranslateAll} fait de même et remplace aussi les traductions modifiées ou publiées.',
  'page.jobsTitle': 'Traductions récentes',
  'page.colWhen': 'Date',
  'page.colSource': 'Source',
  'page.colLanguage': 'Langue',
  'page.colResult': 'Résultat',
  'page.colDetails': 'Détails',
  'page.noJobs': 'Aucune traduction pour l’instant. Ajoutez un tag à un article pour commencer.',
  'page.retranslate': '(nouvelle traduction)',
  'page.openTranslation': 'Ouvrir la traduction',
  'page.languagesTitle': 'Langues',
  'page.sourceLanguage': 'Langue source :',
  'page.colTarget': 'Langue cible',
  'page.colTranslate': 'Traduire',
  'page.colRetranslate': 'Retraduire',
  'page.colMarks': 'Marque les traductions',
  'page.connectionTitle': 'Connexion',
  'page.supertextApi': 'API Supertext',
  'page.apiKey': 'Clé API',
  'page.configured': 'Configurée',
  'page.missing': 'Manquante',
  'page.missingKeyHint': '— définissez SUPERTEXT_API_KEY',
  'page.keyHelp':
    'Pas encore de compte Supertext ? <a href="{signupUrl}" target="_blank" rel="noopener">Créez-en un sur supertext.com</a>. Générez votre clé API sur <a href="{apiKeyUrl}" target="_blank" rel="noopener">supertext.com → Integrations → API</a> (rôle Admin requis).',
  'page.ghost': 'Ghost',
  'page.connected': 'Connecté',
  'page.notConnected': 'Non connecté',
  'page.noGhostKey': 'Aucune clé API Admin de Ghost n’est configurée.',
  'page.webhookSignature': 'Signature du webhook',
  'page.checked': 'Vérifiée',
  'page.notChecked': 'Non vérifiée',
  'page.webhookHint': '— définissez un secret de webhook',
  'page.version': 'Version du connecteur',
  'page.signedInAs': 'Connecté en tant que',
  'page.ghostStarting': 'Ghost démarre, un instant…',

  'status.created': 'Créé',
  'status.failed': 'Échec',
  'status.kept': 'Non écrasé',
  'status.running': 'Traduction en cours…',
  'status.skipped': 'Ignoré',
  'status.updated': 'Mis à jour',

  'job.translating': 'Traduction en cours…',
  'job.interrupted': 'Interrompu par un redémarrage. Retirez le tag, enregistrez, puis ajoutez-le à nouveau.',
  'job.isTranslationPost': 'Cet article est lui-même une traduction. Ajoutez plutôt le tag à l’article original.',
  'job.isTranslationPage': 'Cette page est elle-même une traduction. Ajoutez plutôt le tag à la page originale.',
  'job.noLexicalPost':
    'Cet article n’a pas de contenu dans le format d’éditeur actuel de Ghost. Ouvrez-le dans Ghost Admin, faites une petite modification, enregistrez, puis ajoutez à nouveau le tag.',
  'job.noLexicalPage':
    'Cette page n’a pas de contenu dans le format d’éditeur actuel de Ghost. Ouvrez-la dans Ghost Admin, faites une petite modification, enregistrez, puis ajoutez à nouveau le tag.',
  'job.noApiKey':
    'Aucune clé API Supertext n’est configurée (SUPERTEXT_API_KEY). Pas encore de compte Supertext ? Créez-en un sur {signupUrl}. Générez votre clé API sur {apiKeyUrl} (rôle Admin requis).',
  'job.keptPublished':
    'La traduction en {language} est publiée, elle n’a donc pas été écrasée. Ajoutez {retranslateTag} pour la remplacer quand même.',
  'job.keptScheduled':
    'La traduction en {language} est programmée, elle n’a donc pas été écrasée. Ajoutez {retranslateTag} pour la remplacer quand même.',
  'job.keptSent':
    'La traduction en {language} a été envoyée, elle n’a donc pas été écrasée. Ajoutez {retranslateTag} pour la remplacer quand même.',
  'job.keptOther':
    'La traduction en {language} a le statut {state}, elle n’a donc pas été écrasée. Ajoutez {retranslateTag} pour la remplacer quand même.',
  'job.keptEdited':
    'La traduction en {language} a été modifiée après sa création par Supertext, elle n’a donc pas été écrasée. Ajoutez {retranslateTag} pour la remplacer quand même.',
  'job.created': 'Brouillon en {language} « {title} » créé.',
  'job.updated': 'Traduction en {language} « {title} » mise à jour.',
  'job.partly': '{count} partie(s) de texte sont revenues vides et sont restées dans la langue source.',
  'job.unexpected': 'Erreur inattendue : {error}',

  'error.authentication_failure':
    'Échec de l’authentification. Veuillez vérifier votre clé API Supertext. Pas encore de compte Supertext ? Créez-en un sur {signupUrl}. Générez votre clé API sur {apiKeyUrl} (rôle Admin requis).',
  'error.file_deleted': 'Le fichier de traduction Supertext a été supprimé avant de pouvoir être téléchargé.',
  'error.incomplete_response': 'Le document traduit était vide.',
  'error.missing_api_key':
    'Aucune clé API Supertext n’est configurée. Pas encore de compte Supertext ? Créez-en un sur {signupUrl}. Générez votre clé API sur {apiKeyUrl} (rôle Admin requis).',
  'error.no_file_id': 'Supertext n’a pas renvoyé d’identifiant de fichier.',
  'error.not_found': 'La ressource Supertext demandée est introuvable.',
  'error.payload_too_large': 'Le document est trop volumineux pour être traduit par Supertext.',
  'error.quota_exceeded': 'Votre limite de traduction Supertext est dépassée. Veuillez passer à un abonnement supérieur.',
  'error.service_unavailable': 'Le service Supertext est indisponible.',
  'error.timeout': 'Délai dépassé en attendant la fin de la traduction Supertext.',
  'error.too_many_requests': 'Trop de requêtes envoyées à Supertext. Veuillez réessayer dans un instant.',
  'error.translation_error': 'Supertext n’a pas pu traduire le document.',
  'error.transport_error': 'Impossible de joindre Supertext : {error}',
  'error.unexpected_status': 'Supertext a renvoyé un code de statut inattendu : {status}.',
  'error.detail': '{message} — {detail}',

  'ghost.http': 'Ghost a répondu avec HTTP {status}',
  'ghost.httpDetail': 'Ghost a répondu avec HTTP {status} : {detail}',
  'ghost.noPost': 'Ghost n’a renvoyé aucun article {id}',
  'ghost.noPage': 'Ghost n’a renvoyé aucune page {id}',

  'tag.translateAll': 'Supertext : ajoutez-le à un article et enregistrez pour le traduire dans toutes les langues configurées.',
  'tag.retranslateAll': 'Supertext : comme #translate-all, mais écrase aussi les traductions modifiées ou publiées.',
  'tag.translate': 'Supertext : ajoutez-le à un article et enregistrez pour obtenir un brouillon en {language}.',
  'tag.retranslate': 'Supertext : comme {translateTag}, mais écrase aussi une traduction en {language} modifiée ou publiée.',
  'tag.lang': 'Marque une traduction en {language} (défini par Supertext).',
  'tag.results': 'Résultats : {url}',
}
