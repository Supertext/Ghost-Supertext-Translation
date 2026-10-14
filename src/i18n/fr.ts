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
  'page.keyCheck': 'Vérification de la clé API',
  'page.checkedAt': 'vérifiée le {time}',
  'page.notCheckedYet': 'Pas encore vérifiée.',
  'page.reports': 'Envoyer les informations de version à Supertext',
  'page.reportsOn': 'Activé',
  'page.reportsOff': 'Désactivé (SUPERTEXT_VERSION_REPORTS=0)',
  'page.reportsHelp': 'Envoie à Supertext l’URL du site ainsi que les versions de ce connecteur, de Ghost et de l’environnement d’exécution après une mise à jour et lorsque la clé API change. Le support Supertext voit ainsi quelle version vous utilisez. Aucun contenu, aucune clé API et aucune donnée personnelle ne sont transmis. Définissez SUPERTEXT_VERSION_REPORTS=0 pour le désactiver.',
  'page.pingUrl': 'Adresse de ping',
  'page.notMapped': 'Non associée : ajoutez-la à SUPERTEXT_LANGUAGE_MAP',
  'page.politenessBlocked': 'Supertext ne propose pas de choix formel/informel pour cette langue : retirez-la de SUPERTEXT_POLITENESS',
  'page.politenessIgnored': 'Supertext ne propose pas de choix formel/informel pour cette langue ; elle est traduite avec le ton par défaut',
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
  'error.invalid_language_pair': 'Supertext ne prend pas en charge cette paire de langues ({source} → {target}). Vérifiez l’association des langues (SUPERTEXT_LANGUAGE_MAP).',
  'error.payload_too_large': 'Le document est trop volumineux pour être traduit par Supertext.',
  'error.quota_exceeded': 'Votre limite de traduction Supertext est dépassée. Veuillez passer à un abonnement supérieur.',
  'error.service_unavailable': 'Le service Supertext est indisponible.',
  'error.timeout': 'Délai dépassé en attendant la fin de la traduction Supertext.',
  'error.too_many_requests': 'Trop de requêtes envoyées à Supertext. Veuillez réessayer dans un instant.',
  'error.translation_error': 'Supertext n’a pas pu traduire le document.',
  'error.transport_error': 'Impossible de joindre Supertext : {error}',
  'error.unexpected_status': 'Supertext a renvoyé un code de statut inattendu : {status}.',
  'error.detail': '{message} — {detail}',
  'error.unsupported_language': 'La langue {language} ({code}) n’est encore associée à aucune langue Supertext. Demandez à votre administrateur de l’associer (SUPERTEXT_LANGUAGE_MAP, p. ex. de=de-CH).',
  'error.unsupported_feature': 'Supertext ne propose pas de ton formel ou informel pour cette langue. Choisissez le ton par défaut (SUPERTEXT_POLITENESS).',
  'keycheck.ok': 'Clé API vérifiée : la connexion à Supertext fonctionne.',
  'keycheck.invalid': 'Supertext a refusé la clé API. Vérifiez que vous avez copié la clé entière ou générez-en une nouvelle sur supertext.com → Integrations → API (rôle Admin requis). Pas encore de compte Supertext ? Créez-en un sur supertext.com.',
  'keycheck.missing': 'Aucune clé API n’est encore saisie. Pas encore de compte Supertext ? Créez-en un sur supertext.com. Générez votre clé API sur supertext.com → Integrations → API (rôle Admin requis).',
  'keycheck.unreachable': 'La clé API n’a pas pu être vérifiée, car Supertext n’est pas joignable. Les paramètres sont enregistrés ; réessayez plus tard.',
  'keycheck.error': 'La clé API n’a pas pu être vérifiée : Supertext a répondu par une erreur ({status}). Les paramètres sont enregistrés ; réessayez plus tard.',

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
