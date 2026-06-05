rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /routes/{routeId} {
      allow create: if request.auth != null
        && request.resource.data.userId == request.auth.uid;

      allow read, update, delete: if request.auth != null
        && resource.data.userId == request.auth.uid;
    }
  }
}
