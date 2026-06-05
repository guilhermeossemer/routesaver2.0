# Publicar RouteSaver

## Arquivos para o GitHub Pages

Publique o conteudo da pasta `publicar-github-pages` na raiz do repositorio `routesaver1.1`.

Depois de publicar, abra:

```text
https://guilhermeossemer.github.io/routesaver1.1/
```

Se aparecer uma versao antiga, abra uma vez:

```text
https://guilhermeossemer.github.io/routesaver1.1/limpar-cache.html
```

## Google Cloud

Na chave de API usada pelo RouteSaver, deixe estas APIs permitidas:

- Maps JavaScript API
- Places API (New)
- Routes API

Em restricoes de aplicativo, use `Sites` e adicione:

```text
https://guilhermeossemer.github.io/routesaver1.1/*
https://guilhermeossemer.github.io/*
http://localhost:8765/*
http://127.0.0.1:8765/*
```

## Map ID

O projeto esta pronto para Map ID proprio, mas ainda usa:

```text
DEMO_MAP_ID
```

Quando criar um Map ID no Google Cloud, troque em:

```text
public/js/maps-config.js
```

Campo:

```js
googleMapId: "DEMO_MAP_ID"
```

## Firebase Auth

No Firebase Authentication, adicione este dominio autorizado:

```text
guilhermeossemer.github.io
```

## Firebase Firestore

Use regras que permitam cada usuario acessar somente as proprias rotas. Um modelo esta em:

```text
firestore.rules
```

## Depois de publicar

No celular, abra a URL publicada e teste:

- login automatico
- iniciar rota
- adicionar ponto pela mira
- buscar local
- subir, descer e excluir pontos
- salvar rota
- abrir rota no Google Maps

Se a versao antiga aparecer, recarregue a pagina e limpe o cache do navegador.
