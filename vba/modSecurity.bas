Attribute VB_Name = "modSecurity"
Option Explicit

' Windows CryptoAPI を使った SHA-256 実装(外部ライブラリ参照不要)。
' パスワードは平文では保存せず、職員ごとのソルトを付けてハッシュ化したものだけを
' 職員マスタシートに保存する。

Private Const PROV_RSA_AES As Long = 24
Private Const CRYPT_VERIFYCONTEXT As Long = &HF0000000
Private Const CALG_SHA_256 As Long = &H800C&
Private Const HP_HASHVAL As Long = &H2&

#If VBA7 Then
    Private Declare PtrSafe Function CryptAcquireContext Lib "advapi32.dll" Alias "CryptAcquireContextW" _
        (ByRef phProv As LongPtr, ByVal pszContainer As String, ByVal pszProvider As String, _
         ByVal dwProvType As Long, ByVal dwFlags As Long) As Long
    Private Declare PtrSafe Function CryptReleaseContext Lib "advapi32.dll" _
        (ByVal hProv As LongPtr, ByVal dwFlags As Long) As Long
    Private Declare PtrSafe Function CryptCreateHash Lib "advapi32.dll" _
        (ByVal hProv As LongPtr, ByVal Algid As Long, ByVal hKey As LongPtr, ByVal dwFlags As Long, ByRef phHash As LongPtr) As Long
    Private Declare PtrSafe Function CryptHashData Lib "advapi32.dll" _
        (ByVal hHash As LongPtr, ByRef pbData As Byte, ByVal dwDataLen As Long, ByVal dwFlags As Long) As Long
    Private Declare PtrSafe Function CryptGetHashParam Lib "advapi32.dll" _
        (ByVal hHash As LongPtr, ByVal dwParam As Long, ByRef pbData As Byte, ByRef pdwDataLen As Long, ByVal dwFlags As Long) As Long
    Private Declare PtrSafe Function CryptDestroyHash Lib "advapi32.dll" (ByVal hHash As LongPtr) As Long
#Else
    Private Declare Function CryptAcquireContext Lib "advapi32.dll" Alias "CryptAcquireContextW" _
        (ByRef phProv As Long, ByVal pszContainer As String, ByVal pszProvider As String, _
         ByVal dwProvType As Long, ByVal dwFlags As Long) As Long
    Private Declare Function CryptReleaseContext Lib "advapi32.dll" _
        (ByVal hProv As Long, ByVal dwFlags As Long) As Long
    Private Declare Function CryptCreateHash Lib "advapi32.dll" _
        (ByVal hProv As Long, ByVal Algid As Long, ByVal hKey As Long, ByVal dwFlags As Long, ByRef phHash As Long) As Long
    Private Declare Function CryptHashData Lib "advapi32.dll" _
        (ByVal hHash As Long, ByRef pbData As Byte, ByVal dwDataLen As Long, ByVal dwFlags As Long) As Long
    Private Declare Function CryptGetHashParam Lib "advapi32.dll" _
        (ByVal hHash As Long, ByVal dwParam As Long, ByRef pbData As Byte, ByRef pdwDataLen As Long, ByVal dwFlags As Long) As Long
    Private Declare Function CryptDestroyHash Lib "advapi32.dll" (ByVal hHash As Long) As Long
#End If

' ソルトは「同じパスワードでもハッシュ値が職員ごとに変わる」ようにするためのものであり、
' 暗号学的な乱数強度までは求めていないため、標準のRnd関数で生成する。
Public Function GenerateSalt() As String
    Dim i As Long, s As String
    Randomize
    For i = 1 To 32
        s = s & Hex$(Int(Rnd() * 16))
    Next i
    GenerateSalt = s
End Function

Public Function VerifyPassword(ByVal plainPassword As String, ByVal salt As String, ByVal storedHash As String) As Boolean
    If salt = "" Or storedHash = "" Then
        VerifyPassword = False
        Exit Function
    End If
    VerifyPassword = (SHA256Hex(salt & plainPassword) = LCase$(storedHash))
End Function

Public Function SHA256Hex(ByVal plainText As String) As String
#If VBA7 Then
    Dim hProv As LongPtr, hHash As LongPtr
#Else
    Dim hProv As Long, hHash As Long
#End If
    Dim data() As Byte
    Dim hashBytes(31) As Byte
    Dim hashLen As Long
    Dim i As Long
    Dim result As String

    data = StrToUTF8Bytes(plainText)

    If CryptAcquireContext(hProv, vbNullString, vbNullString, PROV_RSA_AES, CRYPT_VERIFYCONTEXT) = 0 Then
        Err.Raise vbObjectError + 1001, "SHA256Hex", "CryptAcquireContext に失敗しました。"
    End If

    If CryptCreateHash(hProv, CALG_SHA_256, 0, 0, hHash) = 0 Then
        CryptReleaseContext hProv, 0
        Err.Raise vbObjectError + 1002, "SHA256Hex", "CryptCreateHash に失敗しました。"
    End If

    If CryptHashData(hHash, data(0), UBound(data) - LBound(data) + 1, 0) = 0 Then
        CryptDestroyHash hHash
        CryptReleaseContext hProv, 0
        Err.Raise vbObjectError + 1003, "SHA256Hex", "CryptHashData に失敗しました。"
    End If

    hashLen = 32
    If CryptGetHashParam(hHash, HP_HASHVAL, hashBytes(0), hashLen, 0) = 0 Then
        CryptDestroyHash hHash
        CryptReleaseContext hProv, 0
        Err.Raise vbObjectError + 1004, "SHA256Hex", "CryptGetHashParam に失敗しました。"
    End If

    result = ""
    For i = 0 To hashLen - 1
        result = result & Right$("0" & Hex$(hashBytes(i)), 2)
    Next i

    CryptDestroyHash hHash
    CryptReleaseContext hProv, 0

    SHA256Hex = LCase$(result)
End Function

' ADODB.Stream を使い、日本語を含む文字列でも安全にUTF-8バイト列へ変換する(BOMは除去)
Private Function StrToUTF8Bytes(ByVal s As String) As Byte()
    Dim stm As Object
    Set stm = CreateObject("ADODB.Stream")
    stm.Type = 2 ' adTypeText
    stm.Charset = "utf-8"
    stm.Open
    stm.WriteText s
    stm.Position = 0
    stm.Type = 1 ' adTypeBinary
    Dim raw() As Byte
    raw = stm.Read
    stm.Close

    If (UBound(raw) - LBound(raw) + 1) >= 3 Then
        If raw(0) = &HEF And raw(1) = &HBB And raw(2) = &HBF Then
            Dim trimmed() As Byte
            Dim n As Long
            n = UBound(raw) - 3
            If n < 0 Then n = 0
            ReDim trimmed(n)
            Dim i As Long
            For i = 3 To UBound(raw)
                trimmed(i - 3) = raw(i)
            Next i
            StrToUTF8Bytes = trimmed
            Exit Function
        End If
    End If
    StrToUTF8Bytes = raw
End Function
