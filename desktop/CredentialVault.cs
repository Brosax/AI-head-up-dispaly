using System;
using System.Security.Cryptography;
using System.Text;
internal static class CredentialVault {
    static int Main(string[] args) {
        try {
            string input=Console.In.ReadToEnd();
            if(args.Length!=1)return 1;
            if(args[0]=="protect") Console.Write(Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(input),null,DataProtectionScope.CurrentUser)));
            else if(args[0]=="unprotect") Console.Write(Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(input),null,DataProtectionScope.CurrentUser)));
            else return 1;
            return 0;
        } catch { Console.Error.Write("Credential protection failed.");return 1; }
    }
}
