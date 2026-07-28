Attribute VB_Name = "modSetup"
Option Explicit

' 職員(申請者・承認者)を職員マスタへ登録する。パスワードは平文では保存されない。
Public Sub RegisterStaff()
    Dim staffName As String
    staffName = Trim$(InputBox("登録する職員の氏名を入力してください。", "職員登録"))
    If staffName = "" Then Exit Sub

    If FindStaffMasterRow(staffName) > 0 Then
        MsgBox "同じ氏名が既に登録されています。", vbExclamation
        Exit Sub
    End If

    Dim roleChoice As VbMsgBoxResult
    roleChoice = MsgBox(staffName & " さんに承認権限を付与しますか?" & vbCrLf & _
                         "「はい」= 承認者(申請と承認/ロールバックの両方が可能)" & vbCrLf & _
                         "「いいえ」= 一般職員(申請のみ)", vbYesNo + vbQuestion, "権限設定")
    Dim role As String
    role = IIf(roleChoice = vbYes, "一般・承認者", "一般")

    Dim pwd As String, pwd2 As String
    Do
        pwd = InputBox(staffName & " さんのパスワードを入力してください。(半角英数字推奨)", "パスワード設定")
        If pwd = "" Then Exit Sub
        pwd2 = InputBox("確認のため、もう一度同じパスワードを入力してください。", "パスワード確認")
        If pwd <> pwd2 Then
            MsgBox "パスワードが一致しませんでした。もう一度お願いします。", vbExclamation
        End If
    Loop While pwd <> pwd2

    Dim salt As String, hash As String
    salt = GenerateSalt()
    hash = SHA256Hex(salt & pwd)

    Dim masterWs As Worksheet
    Set masterWs = ThisWorkbook.Sheets("職員マスタ")
    Dim r As Long
    r = masterWs.Cells(masterWs.Rows.Count, 1).End(xlUp).Row + 1
    masterWs.Cells(r, 1).Value = staffName
    masterWs.Cells(r, 2).Value = role
    masterWs.Cells(r, 3).Value = salt
    masterWs.Cells(r, 4).Value = hash
    masterWs.Cells(r, 5).Value = Now
    masterWs.Cells(r, 5).NumberFormat = "yyyy/mm/dd hh:mm:ss"

    RefreshStaffValidation

    MsgBox staffName & " さんを登録しました。(権限: " & role & ")", vbInformation

    ThisWorkbook.Save
End Sub

' 本人がパスワードを変更する(現在のパスワードの確認が必要)。
Public Sub ChangeMyPassword()
    Dim staffName As String
    staffName = Trim$(InputBox("氏名を入力してください。", "パスワード変更"))
    If staffName = "" Then Exit Sub

    Dim staffRow As Long
    staffRow = FindStaffMasterRow(staffName)
    If staffRow = 0 Then
        MsgBox "職員マスタに見つかりません。", vbCritical
        Exit Sub
    End If

    Dim masterWs As Worksheet
    Set masterWs = ThisWorkbook.Sheets("職員マスタ")

    Dim oldPwd As String
    oldPwd = InputBox("現在のパスワードを入力してください。", "パスワード変更")
    If Not VerifyPassword(oldPwd, CStr(masterWs.Cells(staffRow, 3).Value), CStr(masterWs.Cells(staffRow, 4).Value)) Then
        MsgBox "現在のパスワードが正しくありません。", vbCritical
        Exit Sub
    End If

    Dim newPwd As String, newPwd2 As String
    Do
        newPwd = InputBox("新しいパスワードを入力してください。", "パスワード変更")
        If newPwd = "" Then Exit Sub
        newPwd2 = InputBox("確認のため、もう一度入力してください。", "パスワード変更")
        If newPwd <> newPwd2 Then
            MsgBox "一致しませんでした。もう一度お願いします。", vbExclamation
        End If
    Loop While newPwd <> newPwd2

    Dim newSalt As String
    newSalt = GenerateSalt()
    masterWs.Cells(staffRow, 3).Value = newSalt
    masterWs.Cells(staffRow, 4).Value = SHA256Hex(newSalt & newPwd)

    MsgBox "パスワードを変更しました。", vbInformation
    ThisWorkbook.Save
End Sub

' 申請・承認・ロールバックの各シートの氏名入力欄に、職員マスタに基づくドロップダウンを設定する。
Public Sub RefreshStaffValidation()
    Dim masterWs As Worksheet
    Set masterWs = ThisWorkbook.Sheets("職員マスタ")
    Dim lastRow As Long
    lastRow = masterWs.Cells(masterWs.Rows.Count, 1).End(xlUp).Row

    Dim reqWs As Worksheet, apprWs As Worksheet, rbWs As Worksheet
    Set reqWs = ThisWorkbook.Sheets("申請")
    Set apprWs = ThisWorkbook.Sheets("承認")
    Set rbWs = ThisWorkbook.Sheets("ロールバック")

    SetNameValidation reqWs.Range("B3"), lastRow
    SetNameValidation apprWs.Range("B4"), lastRow
    SetNameValidation rbWs.Range("B4"), lastRow
End Sub

Private Sub SetNameValidation(ByVal targetCell As Range, ByVal lastRow As Long)
    With targetCell.Validation
        .Delete
        If lastRow >= 2 Then
            .Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, _
                 Formula1:="=職員マスタ!$A$2:$A$" & lastRow
        End If
    End With
End Sub

' 各シートに操作ボタン(フォームコントロール)がなければ自動作成する。
Public Sub SetupButtons()
    AddButton "申請", "申請する", "B12", "SubmitRequest"
    AddButton "承認", "承認/却下を実行", "D8", "ProcessApproval"
    AddButton "ロールバック", "選択した変更を取り消す", "D7", "RollbackChange"
End Sub

Private Sub AddButton(ByVal sheetName As String, ByVal caption As String, ByVal anchorCell As String, ByVal macroName As String)
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets(sheetName)

    Dim shp As Shape
    For Each shp In ws.Shapes
        If shp.Name = "btn_" & macroName Then Exit Sub
    Next shp

    Dim rng As Range
    Set rng = ws.Range(anchorCell)

    Dim btn As Button
    Set btn = ws.Buttons.Add(rng.Left, rng.Top, 170, 26)
    btn.Name = "btn_" & macroName
    btn.Caption = caption
    btn.OnAction = macroName
End Sub
