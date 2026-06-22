{
  description = "IPP print orchestrator";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    bun2nix = {
      url = "github:nix-community/bun2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      bun2nix,
    }:
    let
      lib = nixpkgs.lib;

      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forAllSystems =
        f:
        lib.genAttrs systems (
          system:
          let
            pkgs = import nixpkgs {
              inherit system;
              config.allowUnfreePredicate =
                pkg:
                builtins.elem (lib.getName pkg) [
                  "hp-uld-hp135a"
                ];
            };
          in
          f {
            inherit pkgs system;
            bun2nix = bun2nix.packages.${system}.default;
          }
        );
    in
    {
      packages = forAllSystems (
        { pkgs, bun2nix, ... }:
        import ./nix/packages {
          inherit pkgs bun2nix;
          src = self;
        }
      );

      nixosModules.ipp-print-orchestrator = import ./nix/modules/ipp-print-orchestrator.nix;

      checks = forAllSystems (
        { pkgs, ... }:
        import ./nix/checks {
          inherit pkgs;
          src = self;
          packages = self.packages.${pkgs.stdenv.hostPlatform.system};
          nixosModule = self.nixosModules.ipp-print-orchestrator;
        }
      );

      devShells = forAllSystems (
        { pkgs, ... }: {
          default = import ./nix/dev-shell.nix { inherit pkgs; };
        }
      );

      formatter = forAllSystems ({ pkgs, ... }: import ./nix/formatter.nix { inherit pkgs; });
    };
}
