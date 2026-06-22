{
  lib,
  stdenvNoCC,
  bun2nix,
  cups-filters,
  hp-uld-hp135a,
  makeWrapper,
  nodejs-slim,
  poppler-utils,
  src,
}:

let
  appName = "ipp-print-orchestrator";
  serviceDir = "share/${appName}/service";
  filterDir = "libexec/${appName}";
  modulePackageJson = ''{ "type": "module" }'';
in
stdenvNoCC.mkDerivation {
  pname = appName;
  version = "0.1.0";

  inherit src;

  nativeBuildInputs = [
    bun2nix.hook
    makeWrapper
  ];

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ../bun-runtime.nix;
  };

  bunInstallFlags = [ "--linker=hoisted" ];
  dontRunLifecycleScripts = true;

  postPatch = ''
    cp ${../js-runtime/package.json} package.json
    cp ${../js-runtime/bun.lock} bun.lock
  '';

  buildPhase = ''
    runHook preBuild

    bun build apps/agent/src/main.ts \
      --target=node \
      --format=esm \
      --splitting \
      --outdir dist-service

    bun build apps/agent/src/cli/cups-pdf-preflight-filter.ts \
      --target=node \
      --format=esm \
      --outfile dist-cups-filter/cups-pdf-preflight-filter.js

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/${serviceDir}" "$out/${filterDir}" "$out/bin" "$out/lib/cups/filter"
    cp -R dist-service/. "$out/${serviceDir}/"
    install -Dm644 dist-cups-filter/cups-pdf-preflight-filter.js \
      "$out/${filterDir}/cups-pdf-preflight-filter.js"

    printf '%s\n' '${modulePackageJson}' > "$out/${serviceDir}/package.json"
    printf '%s\n' '${modulePackageJson}' > "$out/${filterDir}/package.json"

    makeWrapper ${lib.getExe nodejs-slim} "$out/bin/ipp-print-orchestrator-agent" \
      --add-flags "$out/${serviceDir}/main.js"

    makeWrapper ${lib.getExe nodejs-slim} "$out/lib/cups/filter/ipp-pdf-preflight-to-spl" \
      --add-flags "$out/${filterDir}/cups-pdf-preflight-filter.js" \
      --prefix PATH : ${lib.makeBinPath [ poppler-utils ]} \
      --set IPP_ORCH_CUPS_PDFTOPDF_FILTER "${cups-filters}/lib/cups/filter/pdftopdf" \
      --set IPP_ORCH_CUPS_GSTORASTER_FILTER "${cups-filters}/lib/cups/filter/gstoraster" \
      --set IPP_ORCH_CUPS_RASTERTOSPL_FILTER "${hp-uld-hp135a}/lib/cups/filter/rastertospl" \
      --set-default XDG_CACHE_HOME "/var/cache/ipp-print-orchestrator"

    runHook postInstall
  '';

  meta = {
    description = "IPP print orchestrator service and CUPS PDF preflight filter";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
}
