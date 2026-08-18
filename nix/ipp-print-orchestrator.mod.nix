{ inputs, self, ... }:
{
  perSystem =
    {
      config,
      lib,
      pkgs,
      system,
      ...
    }:
    {
      packages.default = config.packages.ipp-print-orchestrator;

      packages.ipp-print-orchestrator = pkgs.callPackage (
        {
          cups-filters,
          lib,
          makeWrapper,
          nodejs-slim,
          poppler-utils,
          stdenvNoCC,
        }:
        let
          inherit (lib.meta) getExe;
          inherit (lib.strings) makeBinPath;
          inherit (lib.trivial) importJSON;

          bun2nix = inputs.bun2nix.packages.${system}.default;
          appName = "ipp-print-orchestrator";
          serviceDir = "share/${appName}/service";
          filterDir = "libexec/${appName}";
          modulePackageJson = ''{ "type": "module" }'';
        in
        stdenvNoCC.mkDerivation {
          pname = appName;
          version = (importJSON "${self}/package.json").version;

          src = self;

          nativeBuildInputs = [
            bun2nix.hook
            makeWrapper
          ];

          bunDeps = bun2nix.fetchBunDeps {
            bunNix = ./bun-runtime.nix;
          };

          bunInstallFlags = [ "--linker=hoisted" ];
          dontRunLifecycleScripts = true;

          postPatch = /* bash */ ''
            cp ${./js-runtime/package.json} package.json
            cp ${./js-runtime/bun.lock} bun.lock
          '';

          buildPhase = /* bash */ ''
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

          installPhase = /* bash */ ''
            runHook preInstall

            mkdir --parents "$out/${serviceDir}" "$out/${filterDir}" "$out/bin" "$out/lib/cups/filter"
            cp --recursive dist-service/. "$out/${serviceDir}/"
            install -D --mode=644 dist-cups-filter/cups-pdf-preflight-filter.js \
              "$out/${filterDir}/cups-pdf-preflight-filter.js"

            printf '%s\n' '${modulePackageJson}' > "$out/${serviceDir}/package.json"
            printf '%s\n' '${modulePackageJson}' > "$out/${filterDir}/package.json"

            makeWrapper ${getExe nodejs-slim} "$out/bin/ipp-print-orchestrator-agent" \
              --add-flags "$out/${serviceDir}/main.js"

            makeWrapper ${getExe nodejs-slim} "$out/lib/cups/filter/ipp-pdf-preflight-to-spl" \
              --add-flags "$out/${filterDir}/cups-pdf-preflight-filter.js" \
              --prefix PATH : ${makeBinPath [ poppler-utils ]} \
              --set IPP_ORCH_CUPS_PDFTOPDF_FILTER "${cups-filters}/lib/cups/filter/pdftopdf" \
              --set IPP_ORCH_CUPS_GSTORASTER_FILTER "${cups-filters}/lib/cups/filter/gstoraster" \
              --set IPP_ORCH_CUPS_RASTERTOSPL_FILTER "${config.packages.hp-uld-hp135a}/lib/cups/filter/rastertospl" \
              --set-default XDG_CACHE_HOME "/var/cache/ipp-print-orchestrator"

            runHook postInstall
          '';

          meta = {
            description = "IPP print orchestrator service and CUPS PDF preflight filter";
            mainProgram = "ipp-print-orchestrator-agent";
            platforms = [
              "x86_64-linux"
              "aarch64-linux"
            ];
          };
        }
      ) { };

      checks.ipp-print-orchestrator = config.packages.ipp-print-orchestrator;

      checks.js-runtime-manifest =
        let
          inherit (lib.attrsets) filterAttrs mapAttrs;
          inherit (lib.strings) hasPrefix removePrefix toJSON;
          inherit (lib.trivial) importJSON;

          agentDeps = (importJSON "${self}/apps/agent/package.json").dependencies;
          runtimeDeps = (importJSON "${self}/nix/js-runtime/package.json").dependencies;

          pinnedAgentDeps = mapAttrs (name: version: removePrefix "^" version) (
            filterAttrs (name: version: !hasPrefix "workspace:" version) agentDeps
          );
        in
        pkgs.runCommand "ipp-print-orchestrator-js-runtime-manifest-check"
          {
            agentManifest = toJSON pinnedAgentDeps;
            runtimeManifest = toJSON runtimeDeps;
          }
          /* bash */ ''
            if [ "$agentManifest" != "$runtimeManifest" ]; then
              echo "nix/js-runtime/package.json dependencies drifted from apps/agent/package.json" >&2
              echo "agent (pinned):  $agentManifest" >&2
              echo "runtime:         $runtimeManifest" >&2
              exit 1
            fi

            touch "$out"
          '';

      checks.ipp-print-orchestrator-js =
        pkgs.runCommand "ipp-print-orchestrator-js-check"
          {
            nativeBuildInputs = [
              pkgs.coreutils
              pkgs.gnugrep
              pkgs.nodejs-slim
            ];
          }
          /* bash */ ''
            service="${config.packages.ipp-print-orchestrator}/share/ipp-print-orchestrator/service/main.js"
            filter="${config.packages.ipp-print-orchestrator}/libexec/ipp-print-orchestrator/cups-pdf-preflight-filter.js"
            js_root="${config.packages.ipp-print-orchestrator}/share/ipp-print-orchestrator/service ${config.packages.ipp-print-orchestrator}/libexec/ipp-print-orchestrator"

            test -r "$service"
            test -r "$filter"
            test -x "${config.packages.ipp-print-orchestrator}/bin/ipp-print-orchestrator-agent"
            test -x "${config.packages.ipp-print-orchestrator}/lib/cups/filter/ipp-pdf-preflight-to-spl"

            node --check "$service"
            node --check "$filter"

            if grep --dereference-recursive --line-number --extended-regexp "^import .* from \"([^./]|@)" $js_root | grep --invert-match --extended-regexp "from \"node:"; then
              echo "bundled runtime output contains unresolved static package imports" >&2
              exit 1
            fi

            if grep --dereference-recursive --line-number --extended-regexp "import\(\"([^./]|@)" $js_root | grep --invert-match --extended-regexp "import\(\"(node:|http\"|https\")"; then
              echo "bundled runtime output contains unresolved dynamic package imports" >&2
              exit 1
            fi

            touch "$out"
          '';
    };
}
